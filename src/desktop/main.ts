import {
  app,
  BrowserWindow,
  ipcMain,
  utilityProcess,
  Menu,
  Tray,
  nativeImage,
  screen,
  dialog,
  session,
  desktopCapturer,
  globalShortcut,
} from 'electron';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import type { Snapshot, Meeting, Command } from '../contracts/model';
import { renderPreflight } from './preflight';
import { platformInfo, supportedDesktop } from './platform';
import copy from '../../docs/design/ui-copy.json';
dotenv.config({ quiet: true });
app.setName('Meeting Agent');
if (process.env.MEETING_DATA_DIR) app.setPath('userData', process.env.MEETING_DATA_DIR);
dotenv.config({ path: join(app.getPath('userData'), 'provider.env'), quiet: true });
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let workspace: BrowserWindow,
  launcher: BrowserWindow,
  preview: BrowserWindow,
  capture: BrowserWindow,
  tray: Tray;
let state: Snapshot | null = null,
  quitting = false,
  menuOpen = false,
  hoverTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
let worker: Electron.UtilityProcess;
function request(method: string, args?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('SERVICE_TIMEOUT'));
    }, 75000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, method, args });
  });
}
const active = () => state?.meetings.find((m) => m.status === 'active');
const t = (key: string) => {
  const locale = state?.preferences.uiLocale || 'en';
  return (copy[locale] as Record<string, string>)[key] || key;
};
function openWorkspace() {
  preview?.hide();
  workspace.show();
  workspace.focus();
  if (state) workspace.webContents.send('snapshot', { ...state, selectMeetingId: active()?.id });
}
function dispatch(
  type: Command['type'],
  payload: Record<string, unknown> = {},
  meetingId = active()?.id ?? null,
) {
  return request('command', { id: randomUUID(), meetingId, type, payload });
}
let stopResolve: (() => void) | null = null;
async function drainCapture() {
  const draining = active();
  if (!active() || active()!.capture !== 'capturing') {
    sendStop();
    return;
  }
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    stopResolve = () => {
      clearTimeout(timer);
      resolve();
    };
    capture.webContents.send('capture', { action: 'drain' });
    timer = setTimeout(() => {
      sendStop();
      resolve();
    }, 2000);
  });
  stopResolve = null;
  if (state?.capabilities.sttStreaming && draining)
    await request('audioDrain', { meetingId: draining.id, epoch: draining.epoch });
}
function sendStop() {
  capture?.webContents.send('capture', { action: 'stop' });
}
async function stopMeeting(m: Meeting) {
  await drainCapture();
  await dispatch('end', {}, m.id);
}
function showPreview() {
  if (menuOpen || workspace.isFocused()) return;
  const b = launcher.getBounds(),
    area = screen.getDisplayMatching(b).workArea;
  preview.setPosition(
    Math.max(area.x, Math.min(b.x - 330, area.x + area.width - 320)),
    Math.max(area.y, Math.min(b.y, area.y + area.height - 230)),
  );
  preview.showInactive();
}
function hidePreview() {
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => preview.hide(), 300);
}
async function contextMenu() {
  menuOpen = true;
  preview.hide();
  const m = active();
  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: t(m ? 'meeting.open' : 'meeting.start'),
      click: () => {
        openWorkspace();
        if (!m)
          void startMeeting(randomUUID())
            .then((result) => {
              if (result.state === 'needs_setup')
                workspace.webContents.send('snapshot', { ...state, openSettings: true });
            })
            .catch(() => {});
      },
    },
  ];
  if (m) {
    items.push(
      {
        label: t(m.capture === 'capturing' ? 'capture.pause' : 'capture.resume'),
        enabled: m.capture !== 'starting' && ['microphone', 'online'].includes(m.mode),
        click: () =>
          void captureAction(m.capture === 'capturing' ? 'pause' : 'start', m.id).catch(() => {}),
      },
      { label: t('meeting.end'), click: () => void stopMeeting(m) },
    );
  }
  items.push(
    { type: 'separator' },
    {
      label: t('settings.open'),
      click: () => {
        openWorkspace();
        workspace.webContents.send('snapshot', { ...state, openSettings: true });
      },
    },
    { type: 'separator' },
    { label: t('app.quit'), click: () => void quit() },
  );
  Menu.buildFromTemplate(items).popup({
    callback: () => {
      menuOpen = false;
    },
  });
}
async function captureAction(action: string, meetingId: string) {
  const m = state?.meetings.find((m) => m.id === meetingId);
  if (!m) throw new Error('MEETING_NOT_FOUND');
  if (action === 'pause') {
    await drainCapture();
    return dispatch('pause', {}, m.id);
  }
  if (!supportedDesktop()) throw new Error('UNSUPPORTED_PLATFORM');
  if (!state?.capabilities.sttConfigured) throw new Error('STT_NOT_CONFIGURED');
  await dispatch('captureStart', {}, m.id);
  const fresh = ((await request('snapshot')) as Snapshot).meetings.find((m) => m.id === meetingId)!;
  capture.webContents.send('capture', {
    action: 'start',
    meetingId,
    epoch: fresh.epoch,
    mode: fresh.mode,
    deviceId: fresh.audioSettings?.deviceId ?? 'default',
    streaming: state?.capabilities.sttStreaming === true,
  });
}
const startingMeetings = new Map<
  string,
  Promise<{ meetingId: string | null; state: string; reason?: string }>
>();
async function startMeeting(requestId: string) {
  if (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId))
    throw new Error('INVALID_REQUEST');
  const pending = startingMeetings.get(requestId);
  if (pending) return pending;
  const work = (async () => {
    const snapshot = (await request('snapshot')) as Snapshot;
    const current = snapshot.meetings.find((m) => m.status === 'active');
    if (current) return { meetingId: current.id, state: current.capture };
    if (!snapshot.preferences.audio?.setupCompleted)
      return { meetingId: null, state: 'needs_setup', reason: 'AUDIO_SETUP_REQUIRED' };
    if (!snapshot.capabilities.sttConfigured)
      return { meetingId: null, state: 'needs_setup', reason: 'STT_NOT_CONFIGURED' };
    const id = (await request('command', {
      id: requestId,
      meetingId: null,
      type: 'startMeeting',
      payload: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    })) as string;
    state = await request('snapshot');
    openWorkspace();
    if (state!.meetings.find((m) => m.id === id)?.status === 'ended')
      return { meetingId: id, state: 'input_error', reason: 'MEETING_ENDED' };
    if (['capturing', 'starting'].includes(state!.meetings.find((m) => m.id === id)!.capture))
      return { meetingId: id, state: state!.meetings.find((m) => m.id === id)!.capture };
    try {
      await captureAction('start', id);
      return { meetingId: id, state: 'starting' };
    } catch (e) {
      if (e instanceof Error && e.message === 'ALREADY_CAPTURING')
        return { meetingId: id, state: 'starting' };
      await dispatch(
        'captureError',
        {
          epoch: state!.meetings.find((m) => m.id === id)!.epoch,
          code: e instanceof Error ? e.message : 'INPUT_PERMISSION_OR_DEVICE',
        },
        id,
      );
      return { meetingId: id, state: 'input_error' };
    }
  })().finally(() => startingMeetings.delete(requestId));
  startingMeetings.set(requestId, work);
  return work;
}
async function quit() {
  if (quitting) return;
  const m = active();
  if (m) {
    const answer = await dialog.showMessageBox(workspace, {
      type: 'question',
      message: t('app.quitActiveTitle'),
      detail: t('app.quitActiveBody'),
      buttons: [t('action.cancel'), t('app.quitActiveAction')],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer.response !== 1) return;
    try {
      await stopMeeting(m);
    } catch {
      openWorkspace();
      return;
    }
  }
  try {
    await request('shutdown');
  } catch {
    openWorkspace();
    return;
  }
  quitting = true;
  globalShortcut.unregisterAll();
  app.quit();
}
function secureWindow(options: Electron.BrowserWindowConstructorOptions, role: string) {
  const win = new BrowserWindow({
    ...options,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: role === 'capture' ? 'capture' : 'trusted',
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  void win.loadFile(join(__dirname, 'ui', role === 'capture' ? 'capture.html' : 'index.html'), {
    query: { role },
  });
  return win;
}
app.on('second-instance', () => workspace && openWorkspace());
app.on('before-quit', (e) => {
  if (!quitting) {
    e.preventDefault();
    void quit();
  }
});
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  mkdirSync(app.getPath('userData'), { recursive: true });
  worker = utilityProcess.fork(join(__dirname, 'worker.cjs'), [], {
    env: {
      ...process.env,
      MEETING_SYSTEM_LOCALE: process.env.MEETING_SYSTEM_LOCALE ?? app.getLocale(),
      MEETING_DB: join(app.getPath('userData'), 'meetings.sqlite'),
    },
    serviceName: 'Meeting session service',
  });
  worker.on('message', (message: any) => {
    if (message.type === 'sttError') {
      const m = active();
      if (
        m &&
        m.id === message.meetingId &&
        m.epoch === message.epoch &&
        ['starting', 'capturing'].includes(m.capture)
      ) {
        sendStop();
        void dispatch('captureError', { epoch: m.epoch, code: message.code }, m.id).catch(() => {});
      }
      return;
    }
    if (message.type === 'preview') {
      void renderPreflight(message.artifact, __dirname)
        .then(() =>
          worker.postMessage({ id: message.id, method: 'previewResult', args: { ok: true } }),
        )
        .catch(() =>
          worker.postMessage({ id: message.id, method: 'previewResult', args: { ok: false } }),
        );
      return;
    }
    if (message.type === 'snapshot') {
      state = message.value;
      for (const w of [workspace, launcher, preview])
        if (w && !w.isDestroyed()) w.webContents.send('snapshot', state);
      return;
    }
    const call = pending.get(message.id);
    if (call) {
      clearTimeout(call.timer);
      pending.delete(message.id);
      message.ok ? call.resolve(message.value) : call.reject(new Error(message.error));
    }
  });
  worker.on('exit', () => {
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error('SERVICE_UNAVAILABLE'));
    }
    pending.clear();
    sendStop();
    for (const w of [workspace, launcher, preview])
      if (w && !w.isDestroyed())
        w.webContents.send('snapshot', { serviceError: 'SERVICE_UNAVAILABLE' });
  });
  for (const name of ['trusted', 'capture']) {
    const s = session.fromPartition(name);
    s.setPermissionRequestHandler((wc, permission, callback, details) =>
      callback(
        name === 'capture' &&
          wc.id === capture?.webContents.id &&
          ['media', 'display-capture'].includes(permission) &&
          !!active() &&
          details.isMainFrame,
      ),
    );
    s.setPermissionCheckHandler(
      (wc, permission) =>
        name === 'capture' &&
        wc?.id === capture?.webContents.id &&
        ['media', 'display-capture'].includes(permission) &&
        !!active(),
    );
    s.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    );
  }
  session.fromPartition('capture').setDisplayMediaRequestHandler(
    async (req, callback) => {
      if (req.frame !== capture.webContents.mainFrame || active()?.capture !== 'starting') {
        callback({});
        return;
      }
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
        });
        if (sources[0]) callback({ video: sources[0], audio: 'loopback' });
        else callback({});
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );
  workspace = secureWindow(
    {
      width: 1180,
      height: 840,
      minWidth: 800,
      minHeight: 600,
      show: false,
      backgroundColor: '#FFFFFF',
      title: 'Meeting Agent',
    },
    'workspace',
  );
  workspace.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      workspace.hide();
    }
  });
  const area = screen.getPrimaryDisplay().workArea;
  launcher = secureWindow(
    {
      x: area.x + area.width - 64,
      y: area.y + 100,
      width: 44,
      height: 44,
      resizable: false,
      frame: false,
      transparent: false,
      backgroundColor: '#1D2430',
      alwaysOnTop: true,
      skipTaskbar: true,
      show: true,
    },
    'launcher',
  );
  try {
    const point = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'launcher-position.json'), 'utf8'),
    );
    if (Number.isInteger(point.x) && Number.isInteger(point.y)) {
      const work = screen.getDisplayNearestPoint(point).workArea;
      launcher.setPosition(
        Math.max(work.x, Math.min(point.x, work.x + work.width - 44)),
        Math.max(work.y, Math.min(point.y, work.y + work.height - 44)),
      );
    }
  } catch {}
  preview = secureWindow(
    {
      width: 320,
      height: 230,
      resizable: false,
      frame: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      backgroundColor: '#FFFFFF',
    },
    'preview',
  );
  capture = secureWindow({ width: 320, height: 160, show: false, skipTaskbar: true }, 'capture');
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (Math.abs(Math.abs(x - 7.5) + Math.abs(y - 7.5) - 6) < 1.1) {
        const i = (y * 16 + x) * 4;
        pixels[i] = 29;
        pixels[i + 1] = 36;
        pixels[i + 2] = 48;
        pixels[i + 3] = 255;
      }
    }
  const icon = nativeImage.createFromBitmap(pixels, { width: 16, height: 16 });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Meeting Agent');
  tray.on('click', openWorkspace);
  tray.on('right-click', () => void contextMenu());
  state = await request('snapshot');
  if (state?.preferences.shortcut)
    globalShortcut.register(state.preferences.shortcut, () =>
      workspace.isVisible() ? workspace.hide() : openWorkspace(),
    );
  ipcMain.handle('meeting', async (event, method, args) => {
    try {
      const role =
        event.sender === capture.webContents
          ? 'capture'
          : [workspace, launcher, preview].some((w) => w.webContents === event.sender)
            ? 'ui'
            : 'untrusted';
      if (role === 'untrusted' || event.senderFrame !== event.sender.mainFrame)
        throw new Error('PERMISSION_DENIED');
      if (role === 'capture') {
        if (method === 'captureStopped') {
          stopResolve?.();
          return { ok: true };
        }
        if (method === 'audio') return { ok: true, value: await request('audio', args) };
        if (method === 'captureReady')
          return {
            ok: true,
            value: await dispatch(
              'captureReady',
              { epoch: args.epoch, actualDevice: args.actualDevice },
              args.meetingId,
            ),
          };
        if (method === 'captureError') {
          sendStop();
          return {
            ok: true,
            value: await dispatch(
              'captureError',
              { epoch: args.epoch, code: args.code },
              args.meetingId,
            ),
          };
        }
        throw new Error('PERMISSION_DENIED');
      }
      let value: unknown;
      switch (method) {
        case 'startMeeting':
          value = await startMeeting(args.requestId);
          break;
        case 'devices':
          value = await capture.webContents.executeJavaScript(
            '(async()=>{const devices=await navigator.mediaDevices.enumerateDevices();return devices.filter(d=>d.kind==="audioinput").map(d=>({deviceId:d.deviceId,label:d.label}));})()',
          );
          break;
        case 'applyAudioSettings': {
          const m = active();
          if (!m) throw new Error('MEETING_NOT_FOUND');
          await captureAction('pause', m.id);
          await dispatch('audioSettings', { audio: state!.preferences.audio }, m.id);
          state = await request('snapshot');
          await captureAction('start', m.id);
          value = true;
          break;
        }
        case 'snapshot':
          value = await request('snapshot');
          break;
        case 'platform':
          value = platformInfo();
          break;
        case 'translate':
          value = await request('translate', args);
          break;
        case 'command':
          if (
            ![
              'create',
              'rename',
              'ingest',
              'correct',
              'language',
              'ask',
              'retry',
              'scenario',
              'decision',
              'preferences',
              'end',
            ].includes(args.type)
          )
            throw new Error('PERMISSION_DENIED');
          if (args.type === 'create' && process.env.MEETING_DEV_INPUTS !== '1')
            throw new Error('PERMISSION_DENIED');
          if (args.type === 'ingest' && !['manual', 'replay'].includes(args.payload?.kind))
            throw new Error('PERMISSION_DENIED');
          if (args.type === 'end') await drainCapture();
          if (
            args.type === 'preferences' &&
            args.payload.shortcut !== state?.preferences.shortcut
          ) {
            const old = state?.preferences.shortcut || '',
              next = args.payload.shortcut;
            if (old) globalShortcut.unregister(old);
            if (
              next &&
              !globalShortcut.register(next, () =>
                workspace.isVisible() ? workspace.hide() : openWorkspace(),
              )
            ) {
              if (old)
                globalShortcut.register(old, () =>
                  workspace.isVisible() ? workspace.hide() : openWorkspace(),
                );
              throw new Error('SHORTCUT_CONFLICT');
            }
          }
          value = await request('command', args);
          break;
        case 'capture':
          value = await captureAction(args.action, args.meetingId);
          break;
        case 'open':
          openWorkspace();
          break;
        case 'hide':
          workspace.hide();
          break;
        case 'menu':
          void contextMenu();
          break;
        case 'hover':
          clearTimeout(hoverTimer);
          if (args) hoverTimer = setTimeout(showPreview, 250);
          else hidePreview();
          break;
        case 'drag': {
          if (event.sender !== launcher.webContents) throw new Error('PERMISSION_DENIED');
          const point = screen.getCursorScreenPoint(),
            work = screen.getDisplayNearestPoint(point).workArea;
          launcher.setPosition(
            Math.max(work.x, Math.min(point.x - 22, work.x + work.width - 44)),
            Math.max(work.y, Math.min(point.y - 22, work.y + work.height - 44)),
          );
          preview.hide();
          break;
        }
        case 'snap': {
          const b = launcher.getBounds(),
            work = screen.getDisplayMatching(b).workArea;
          launcher.setPosition(
            b.x < work.x + work.width / 2 ? work.x + 12 : work.x + work.width - 56,
            b.y,
          );
          writeFileSync(
            join(app.getPath('userData'), 'launcher-position.json'),
            JSON.stringify(launcher.getBounds()),
          );
          break;
        }
        case 'export': {
          const m = state?.meetings.find((m) => m.id === args.meetingId);
          if (!m) throw new Error('MEETING_NOT_FOUND');
          const result = await dialog.showSaveDialog(workspace, {
            defaultPath: 'meeting-export.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });
          if (!result.canceled && result.filePath) {
            writeFileSync(
              result.filePath,
              JSON.stringify(
                { schemaVersion: 1, exportedAt: new Date().toISOString(), meeting: m },
                null,
                2,
              ),
              { mode: 0o600 },
            );
            value = true;
          }
          break;
        }
        case 'quit':
          void quit();
          break;
        default:
          throw new Error('INVALID_METHOD');
      }
      return { ok: true, value };
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      return { ok: false, error: /^[A-Z0-9_]+$/.test(raw) ? raw : 'INVALID_REQUEST' };
    }
  });
  // Initial load may precede IPC registration; renderer retries its snapshot read.
  app.on('activate', openWorkspace);
  screen.on('display-removed', () => {
    const work = screen.getPrimaryDisplay().workArea;
    launcher.setPosition(work.x + work.width - 64, work.y + 100);
  });
});
