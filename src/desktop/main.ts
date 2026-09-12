import { PreferencesPatchSchema } from '../domain/preferences';
import { EventEmitter } from 'node:events';
import { MeetingReminder } from './meeting-reminder';
import { SystemReminder } from './system-reminder';
import { onMeetingCandidate, reportMeetingCandidate } from './meeting-signals';
import type { ReminderView } from '../contracts/meeting-candidate';
import { translator } from '../ui/i18n';
import { launcherIndicator } from '../ui/launcher-status';
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
  Notification,
  powerMonitor,
} from 'electron';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import type { Snapshot, Meeting, Command } from '../contracts/model';
import { renderPreflight } from './preflight';
import { platformInfo, supportedDesktop } from './platform';
dotenv.config({ quiet: true });
app.setName('Meeting Agent');
if (process.platform === 'win32') app.setAppUserModelId('dev.meetingagent.desktop');
if (process.env.MEETING_DATA_DIR) app.setPath('userData', process.env.MEETING_DATA_DIR);
dotenv.config({ path: join(app.getPath('userData'), 'provider.env'), quiet: true });
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let workspace: BrowserWindow,
  launcher: BrowserWindow,
  preview: BrowserWindow,
  capture: BrowserWindow,
  reminderWindow: BrowserWindow,
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
const participantWindows = new Map<
  number,
  { window: BrowserWindow; meetingId: string; actorId: string }
>();
const componentWindows = new Map<
  number,
  { window: BrowserWindow; meetingId: string; componentId: string | null; actorId: string }
>();
function componentProjection(value: any, componentId: string | null) {
  return {
    ...value,
    assignmentDirectory: value.components.flatMap((c: any) =>
      c.draft?.content.kind === 'assignment' ? c.draft.content.payload.items : [],
    ),
    components: componentId
      ? value.components.filter((c: any) => c.id === componentId)
      : value.components,
  };
}
async function openComponent(meetingId: string, componentId: string | null) {
  const latest = (await request('snapshot')) as Snapshot;
  const s = latest.meetings.find((m) => m.id === meetingId)?.collaboration;
  const host = s?.participants.find((p) => p.role === 'host');
  if (!host || (componentId && !s!.components.some((c) => c.id === componentId)))
    throw new Error('COMPONENT_NOT_FOUND');
  const existing = [...componentWindows.values()].find(
    (b) => b.meetingId === meetingId && b.componentId === componentId,
  );
  if (existing) {
    existing.window.show();
    existing.window.focus();
    return true;
  }
  const w = secureWindow(
    {
      width: 660,
      height: 780,
      minWidth: 360,
      minHeight: 420,
      title: '会议协作组件',
      alwaysOnTop: true,
      show: true,
    },
    'component',
  );
  const webId = w.webContents.id;
  componentWindows.set(webId, { window: w, meetingId, componentId, actorId: host.id });
  w.on('closed', () => componentWindows.delete(webId));
  return true;
}
let reminders: MeetingReminder;
let nativeReminder: SystemReminder;
let serviceAvailable = false,
  desktopPaused = false;
let notificationUnavailable = false;
const reminderTestMode =
  !app.isPackaged &&
  process.env.MEETING_DEV_INPUTS === '1' &&
  process.env.MEETING_REMINDER_TEST === '1';
const testNotifications: Array<{
  options: { title: string; body: string; silent: boolean };
  events: EventEmitter;
  closed: boolean;
}> = [];
function desktopSnapshot() {
  return state && { ...state, reminder: reminders?.current ?? null, notificationUnavailable };
}
function broadcast() {
  if (!state) return;
  for (const w of [workspace, launcher, preview, reminderWindow])
    if (w && !w.isDestroyed()) w.webContents.send('snapshot', desktopSnapshot());
}
function positionReminder() {
  if (!reminderWindow || !launcher) return;
  const b = launcher.getBounds(),
    area = screen.getDisplayMatching(b).workArea;
  const { width, height } = reminderWindow.getBounds();
  const left = b.x - width - 8;
  const x = left >= area.x ? left : b.x + b.width + 8;
  reminderWindow.setPosition(
    Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    Math.round(Math.max(area.y, Math.min(b.y - 8, area.y + area.height - height))),
  );
}
function presentReminder(view: ReminderView | null) {
  broadcast();
  if (view?.channel === 'bubble') {
    nativeReminder?.clear();
    clearTimeout(hoverTimer);
    preview?.hide();
    positionReminder();
    if (!reminderWindow.isVisible()) reminderWindow.showInactive();
  } else {
    reminderWindow?.hide();
    if (view?.channel === 'system' && view.phase === 'prompt')
      nativeReminder.show(view.id, t('reminder.title'), t('reminder.body'));
    else nativeReminder?.clear();
  }
}
function syncDesktop() {
  if (!state || !launcher) return;
  const visible = state.preferences.launcherVisible !== false;
  if (visible && !launcher.isVisible()) launcher.showInactive();
  if (!visible) {
    launcher.hide();
    preview?.hide();
    clearTimeout(hoverTimer);
  }
  reminders?.synchronize();
  tray?.setToolTip(`Meeting Agent · ${t(launcherIndicator(active(), !serviceAvailable).labelKey)}`);
}
function recoverReminderStart(reason?: string) {
  openWorkspace();
  const needsSetup = reason === 'AUDIO_SETUP_REQUIRED' || reason === 'STT_NOT_CONFIGURED';
  workspace.webContents.send('snapshot', {
    ...desktopSnapshot(),
    selectMeetingId: active()?.id,
    openSettings: needsSetup,
    audioSetup: needsSetup,
    startError: reason === 'AUDIO_SETUP_REQUIRED' ? undefined : reason,
  });
}

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
  return translator(locale)(key);
};
function openWorkspace() {
  preview?.hide();
  workspace.show();
  workspace.focus();
  if (state)
    workspace.webContents.send('snapshot', { ...desktopSnapshot(), selectMeetingId: active()?.id });
}
function dispatch(
  type: Command['type'],
  payload: Record<string, unknown> = {},
  meetingId = active()?.id ?? null,
) {
  return request('command', { id: randomUUID(), meetingId, type, payload });
}
let preferenceWrites: Promise<unknown> = Promise.resolve();
function writePreferences(command: Command) {
  const operation = preferenceWrites.then(async () => {
    if (command.type === 'preferencesPatch') PreferencesPatchSchema.parse(command.payload);
    const fresh = (await request('snapshot')) as Snapshot;
    const old = fresh.preferences.shortcut;
    const next = typeof command.payload.shortcut === 'string' ? command.payload.shortcut : old;
    const changed = next !== old;
    let installedNext = false;
    const toggle = () => (workspace.isVisible() ? workspace.hide() : openWorkspace());
    try {
      if (changed) {
        if (old) globalShortcut.unregister(old);
        if (next) {
          if (!globalShortcut.register(next, toggle)) throw new Error('SHORTCUT_CONFLICT');
          installedNext = true;
        }
      }
      return await request('command', command);
    } catch (error) {
      if (changed) {
        if (installedNext) globalShortcut.unregister(next);
        if (old) globalShortcut.register(old, toggle);
      }
      throw error;
    }
  });
  preferenceWrites = operation.catch(() => {});
  return operation;
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
  if (
    menuOpen ||
    workspace.isFocused() ||
    !launcher.isVisible() ||
    reminders?.current?.channel === 'bubble'
  )
    return;
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
                workspace.webContents.send('snapshot', {
                  ...desktopSnapshot(),
                  openSettings: true,
                });
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
        workspace.webContents.send('snapshot', { ...desktopSnapshot(), openSettings: true });
      },
    },
    {
      label: t(state?.preferences.launcherVisible === false ? 'launcher.show' : 'launcher.hide'),
      click: () => {
        if (!state) return;
        void writePreferences({
          id: randomUUID(),
          meetingId: null,
          type: 'preferencesPatch',
          payload: { launcherVisible: state.preferences.launcherVisible === false },
        }).catch(() => recoverReminderStart('STORAGE_FAILED'));
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
async function startMeeting(
  requestId: string,
  options: { quiet?: boolean; stillValid?: () => boolean } = {},
) {
  if (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId))
    throw new Error('INVALID_REQUEST');
  const pending = startingMeetings.get(requestId);
  if (pending) return pending;
  const work = (async () => {
    const snapshot = (await request('snapshot')) as Snapshot;
    const current = snapshot.meetings.find((m) => m.status === 'active');
    if (current) return { meetingId: current.id, state: current.capture };
    if (options.stillValid && !options.stillValid()) return { meetingId: null, state: 'stale' };
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
    if (!options.quiet) openWorkspace();
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
  reminders?.clear();
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
      MEETING_SYSTEM_LOCALE:
        process.env.MEETING_SYSTEM_LOCALE ??
        app.getPreferredSystemLanguages()[0] ??
        app.getLocale(),
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
        .catch((error) =>
          worker.postMessage({
            id: message.id,
            method: 'previewResult',
            args: {
              ok: false,
              report: error.report ?? {
                ok: false,
                issues: [{ blockId: null, errorCode: 'RENDER_FAILED' }],
              },
            },
          }),
        );
      return;
    }
    if (message.type === 'snapshot') {
      state = message.value;
      serviceAvailable = true;
      syncDesktop();
      broadcast();
      for (const binding of participantWindows.values())
        void request('collaborationSnapshot', {
          meetingId: binding.meetingId,
          actorId: binding.actorId,
        })
          .then((value) => {
            if (!binding.window.isDestroyed()) binding.window.webContents.send('snapshot', value);
          })
          .catch(() => {});
      for (const binding of componentWindows.values())
        void request('collaborationSnapshot', {
          meetingId: binding.meetingId,
          actorId: binding.actorId,
        })
          .then((value) => {
            if (!binding.window.isDestroyed())
              binding.window.webContents.send(
                'snapshot',
                componentProjection(value, binding.componentId),
              );
          })
          .catch(() => {});
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
    serviceAvailable = false;
    reminders?.clear();
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error('SERVICE_UNAVAILABLE'));
    }
    pending.clear();
    sendStop();
    for (const w of [workspace, launcher, preview, reminderWindow])
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
  // Finish async initialization before renderers can invoke the IPC bridge.
  state = await request('snapshot');
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
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
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
  reminderWindow = secureWindow(
    {
      width: 320,
      height: 90,
      resizable: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
    },
    'reminder',
  );
  reminderWindow.webContents.on('did-finish-load', broadcast);
  launcher.on('move', positionReminder);
  reminders = new MeetingReminder({
    context: () => ({
      enabled: state?.preferences.meetingReminders !== false,
      launcherVisible: state?.preferences.launcherVisible !== false,
      available: serviceAvailable && !quitting && !desktopPaused,
      active: active(),
    }),
    present: presentReminder,
    start: (stillValid) => startMeeting(randomUUID(), { quiet: true, stillValid }),
    recover: recoverReminderStart,
  });
  nativeReminder = new SystemReminder({
    supported: () => reminderTestMode || Notification.isSupported(),
    create: (options) => {
      if (!reminderTestMode) return new Notification(options);
      // Unpackaged, explicitly enabled synthetic tests only. Packaged builds cannot use this path.
      const events = new EventEmitter();
      const fixture = { options, events, closed: false };
      testNotifications.push(fixture);
      return {
        on: (event, callback) => events.on(event, callback),
        removeAllListeners: () => events.removeAllListeners(),
        show: () => {},
        close: () => {
          fixture.closed = true;
        },
      };
    },
    accept: (id) => {
      void reminders.accept(id);
    },
    dismiss: (id) => reminders.dismiss(id),
    failed: () => {
      notificationUnavailable = true;
      broadcast();
    },
  });
  const stopSignals = onMeetingCandidate((candidate) => reminders.receive(candidate));
  app.on('will-quit', () => {
    stopSignals();
    reminders.clear();
  });
  const pauseReminders = () => {
    desktopPaused = true;
    reminders.clear();
  };
  const resumeReminders = () => {
    desktopPaused = false;
  };
  powerMonitor.on('suspend', pauseReminders);
  powerMonitor.on('lock-screen', pauseReminders);
  powerMonitor.on('resume', resumeReminders);
  powerMonitor.on('unlock-screen', resumeReminders);
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
  serviceAvailable = true;
  syncDesktop();
  broadcast();
  if (state?.preferences.shortcut)
    globalShortcut.register(state.preferences.shortcut, () =>
      workspace.isVisible() ? workspace.hide() : openWorkspace(),
    );
  ipcMain.handle('meeting', async (event, method, args) => {
    try {
      const componentWindow = componentWindows.get(event.sender.id);
      if (componentWindow) {
        if (event.senderFrame !== event.sender.mainFrame) throw new Error('PERMISSION_DENIED');
        if (method === 'collaborationSnapshot')
          return {
            ok: true,
            value: componentProjection(
              await request(method, {
                meetingId: componentWindow.meetingId,
                actorId: componentWindow.actorId,
              }),
              componentWindow.componentId,
            ),
          };
        if (
          method === 'collaborationCommand' &&
          args?.meetingId === componentWindow.meetingId &&
          (!componentWindow.componentId ||
            args?.payload?.componentId === componentWindow.componentId)
        )
          return {
            ok: true,
            value: await request(method, { command: args, actorId: componentWindow.actorId }),
          };
        throw new Error('PERMISSION_DENIED');
      }
      const participant = participantWindows.get(event.sender.id);
      if (participant) {
        if (event.senderFrame !== event.sender.mainFrame) throw new Error('PERMISSION_DENIED');
        if (method === 'collaborationSnapshot')
          return {
            ok: true,
            value: await request(method, {
              meetingId: participant.meetingId,
              actorId: participant.actorId,
            }),
          };
        if (method === 'collaborationCommand') {
          if (
            args?.meetingId !== participant.meetingId ||
            ![
              'component.respond',
              'component.resolve_report',
              'component.delivery_ack',
              'component.report_new_issue',
            ].includes(args?.type)
          )
            throw new Error('PERMISSION_DENIED');
          return {
            ok: true,
            value: await request(method, { command: args, actorId: participant.actorId }),
          };
        }
        throw new Error('PERMISSION_DENIED');
      }
      const role =
        event.sender === capture.webContents
          ? 'capture'
          : event.sender === reminderWindow.webContents
            ? 'reminder'
            : [workspace, launcher, preview].some((w) => w.webContents === event.sender)
              ? 'ui'
              : 'untrusted';
      if (role === 'untrusted' || event.senderFrame !== event.sender.mainFrame)
        throw new Error('PERMISSION_DENIED');
      if (role === 'reminder') {
        if (method === 'snapshot') return { ok: true, value: desktopSnapshot() };
        if (method === 'reminderAccept')
          return { ok: true, value: await reminders.accept(args?.id) };
        if (method === 'reminderDismiss') {
          reminders.dismiss(args?.id);
          return { ok: true };
        }
        if (method === 'reminderHold' && typeof args?.held === 'boolean') {
          reminders.hold(args?.id, args.held);
          return { ok: true };
        }
        throw new Error('PERMISSION_DENIED');
      }
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
        case 'openReadyComponents': {
          const m = active();
          if (!m?.collaboration) throw new Error('COLLABORATION_NOT_ENABLED');
          value = await openComponent(m.id, null);
          preview.hide();
          break;
        }
        case 'openComponent':
          value = await openComponent(args.meetingId, args.componentId);
          preview.hide();
          break;
        case 'enableCollaboration':
          if (event.sender !== workspace.webContents) throw new Error('PERMISSION_DENIED');
          value = await request(method, args);
          break;
        case 'collaborationSnapshot':
        case 'collaborationCommand':
        case 'openParticipant': {
          if (event.sender !== workspace.webContents) throw new Error('PERMISSION_DENIED');
          const latestState = (await request('snapshot')) as Snapshot;
          const collaboration = latestState.meetings.find(
            (m) => m.id === args?.meetingId,
          )?.collaboration;
          const host = collaboration?.participants.find((p) => p.role === 'host');
          if (!host) throw new Error('COLLABORATION_NOT_ENABLED');
          if (method === 'openParticipant') {
            const person = collaboration!.participants.find(
              (p) => p.id === args.participantId && p.role === 'participant',
            );
            if (!person) throw new Error('PARTICIPANT_NOT_FOUND');
            const existing = [...participantWindows.values()].find(
              (b) => b.meetingId === args.meetingId && b.actorId === person.id,
            );
            if (existing) {
              existing.window.show();
              existing.window.focus();
            } else {
              const w = secureWindow(
                {
                  width: 620,
                  height: 780,
                  minWidth: 360,
                  minHeight: 400,
                  title: `本地模拟 · ${person.displayName}`,
                  alwaysOnTop: true,
                  show: true,
                },
                'participant',
              );
              const webId = w.webContents.id;
              participantWindows.set(webId, {
                window: w,
                meetingId: args.meetingId,
                actorId: person.id,
              });
              w.on('closed', () => participantWindows.delete(webId));
            }
            value = true;
          } else
            value = await request(
              method,
              method === 'collaborationCommand'
                ? { command: args, actorId: host.id }
                : { meetingId: args.meetingId, actorId: host.id },
            );
          break;
        }
        case 'reminderTest': {
          if (!reminderTestMode || event.sender !== workspace.webContents)
            throw new Error('PERMISSION_DENIED');
          if (args?.signal) reportMeetingCandidate(args.signal);
          if (args?.nativeEvent && ['click', 'close', 'failed'].includes(args.nativeEvent))
            testNotifications.at(args.index ?? -1)?.events.emit(args.nativeEvent);
          value = {
            view: reminders.current,
            notifications: testNotifications.map(({ options, closed }) => ({ ...options, closed })),
          };
          break;
        }
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
          state = await request('snapshot');
          value = desktopSnapshot();
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
              'cancelRequest',
              'answerClarification',
              'cancelClarification',
              'retry',
              'scenario',
              'decision',
              'preferences',
              'preferencesPatch',
              'end',
            ].includes(args.type)
          )
            throw new Error('PERMISSION_DENIED');
          if (args.type === 'create' && process.env.MEETING_DEV_INPUTS !== '1')
            throw new Error('PERMISSION_DENIED');
          if (args.type === 'ingest' && !['manual', 'replay'].includes(args.payload?.kind))
            throw new Error('PERMISSION_DENIED');
          if (args.type === 'end') await drainCapture();
          if (args.type === 'preferences' || args.type === 'preferencesPatch') {
            value = await writePreferences(args);
            break;
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
    positionReminder();
  });
});
