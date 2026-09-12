/** Synthetic detector events + oscillator audio + native notification doubles only. */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
let app: ElectronApplication, page: Page, bubble: Page, dir: string, server: Server, base: string;
async function launch(fixture = true) {
  app = await electron.launch({
    args: [resolve('.')],
    env: {
      ...process.env,
      MEETING_DEV_INPUTS: '1',
      MEETING_REMINDER_TEST: fixture ? '1' : '0',
      MEETING_SYSTEM_LOCALE: 'en',
      MEETING_DATA_DIR: dir,
      OPENAI_API_KEY: '',
      MEETING_STT_API_KEY: 'synthetic-not-a-real-key',
      MEETING_STT_API_BASE: base,
    },
  });
  await expect
    .poll(async () => {
      page = (await app.windows()).find((p) => p.url().includes('role=workspace'))!;
      bubble = (await app.windows()).find((p) => p.url().includes('role=reminder'))!;
      return !!page && !!bubble;
    })
    .toBe(true);
  await expect
    .poll(async () => {
      try {
        return (await page.evaluate(() => window.meeting.call('snapshot'))).ok;
      } catch {
        return false;
      }
    })
    .toBe(true);
  await expect(
    page.getByRole('heading', { name: 'Make room for a clearer conversation.' }),
  ).toBeAttached();
  await expect
    .poll(async () => {
      try {
        return (await bubble.evaluate(() => window.meeting.call('snapshot'))).ok;
      } catch {
        return false;
      }
    })
    .toBe(true);
}
const state = () => page.evaluate(async () => (await window.meeting.call('snapshot')).value);
const fixture = (args: any = {}) =>
  page.evaluate(async (args) => (await window.meeting.call('reminderTest', args)).value, args);
const signal = (id = 'synthetic-episode', revision = 1, ttl = 60000, present = true) =>
  fixture({ signal: { id, revision, present, expiresAt: Date.now() + ttl } });
const visible = (role: string) =>
  app.evaluate(
    ({ BrowserWindow }, role) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes(`role=${role}`))
        ?.isVisible(),
    role,
  );
async function preferences(patch: any) {
  const snapshot = await state();
  const result = await page.evaluate(
    (payload) =>
      window.meeting.call('command', {
        id: crypto.randomUUID(),
        meetingId: null,
        type: 'preferences',
        payload,
      }),
    { ...snapshot.preferences, ...patch },
  );
  expect(result.ok).toBe(true);
}
async function syntheticAudio() {
  const capture = (await app.windows()).find((p) => p.url().includes('role=capture'))!;
  await capture.evaluate(() => {
    (window as any).syntheticStarts = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).syntheticStarts++;
      const ctx = new AudioContext(),
        oscillator = ctx.createOscillator(),
        output = ctx.createMediaStreamDestination();
      oscillator.connect(output);
      oscillator.start();
      await ctx.resume();
      (window as any).syntheticContext = ctx;
      return output.stream;
    };
  });
  await preferences({
    audio: {
      deviceId: 'default',
      deviceLabel: 'Synthetic audio fixture',
      includeComputerAudio: false,
      setupCompleted: true,
    },
  });
}
async function stopApp() {
  if (!app || app.process().exitCode !== null) return;
  const closed = app.waitForEvent('close', { timeout: 10000 });
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await closed;
}
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'meeting-reminder-e2e-'));
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ text: '' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  await launch();
});
test.afterEach(async () => {
  await stopApp();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

test('bilingual bubble anchors beside launcher, does not steal focus, closes without recording and stays deduplicated', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('role=workspace'),
    )!;
    w.show();
    w.focus();
  });
  await signal();
  await expect(bubble.getByText('You might be in a meeting')).toBeVisible();
  await expect(bubble.getByText('Click to start recording')).toBeVisible();
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getFocusedWindow()?.webContents.getURL(),
    ),
  ).toContain('role=workspace');
  expect((await state()).meetings).toHaveLength(0);
  await expect.poll(() => visible('reminder')).toBe(true);
  for (const locale of ['en', 'zh-CN']) {
    await preferences({ uiLanguage: locale });
    await expect(
      bubble.getByText(locale === 'en' ? 'You might be in a meeting' : '你可能正在开会'),
    ).toBeVisible();
    expect(await bubble.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const shot = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('role=reminder'))!
          .webContents.capturePage()
      )
        .toPNG()
        .toString('base64'),
    );
    writeFileSync(test.info().outputPath(`reminder-${locale}.png`), Buffer.from(shot, 'base64'));
  }
  const bounds = await app.evaluate(({ BrowserWindow }) =>
    Object.fromEntries(
      ['launcher', 'reminder'].map((role) => [
        role,
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes(`role=${role}`))!
          .getBounds(),
      ]),
    ),
  );
  expect(bounds.reminder.x + bounds.reminder.width).toBeLessThanOrEqual(bounds.launcher.x);
  await bubble.getByRole('button', { name: '关闭提醒', exact: true }).click();
  await expect.poll(() => visible('reminder')).toBe(false);
  await signal('synthetic-episode', 2);
  expect((await fixture()).view).toBeNull();
  expect((await state()).meetings).toHaveLength(0);
});
test('bubble hover holds beyond eight seconds; moving away expires and stale click cannot start', async () => {
  await signal();
  await bubble.getByRole('button', { name: /Click to start recording/ }).hover();
  await page.waitForTimeout(8300);
  expect(await visible('reminder')).toBe(true);
  // CDP pointer movement outside an Electron window does not reliably emit native leave.
  // Dispatch the leave through the rendered component; the real hover above and timer remain exercised.
  await bubble.locator('.meeting-reminder').dispatchEvent('mouseout', { relatedTarget: null });
  await expect.poll(() => visible('reminder'), { timeout: 10000 }).toBe(false);
  const click = await bubble.evaluate(() =>
    window.meeting.call('reminderAccept', { id: 'synthetic-episode' }),
  );
  expect(click.value).toBe(false);
  expect((await state()).meetings).toHaveLength(0);
});
test('click starts one synthetic recording quietly; hide launcher and disable reminders preserve capture; preferences persist', async () => {
  await syntheticAudio();
  await signal();
  await bubble.getByRole('button', { name: /Click to start recording/ }).click();
  await expect.poll(async () => (await state()).meetings[0]?.capture).toBe('capturing');
  expect(await visible('workspace')).toBe(false);
  expect((await state()).meetings).toHaveLength(1);
  await preferences({ launcherVisible: false, meetingReminders: false });
  await expect.poll(() => visible('launcher')).toBe(false);
  expect((await state()).meetings[0].capture).toBe('capturing');
  await signal('another-synthetic');
  await expect.poll(async () => (await fixture()).view).toBeNull();
  const capture = (await app.windows()).find((p) => p.url().includes('role=capture'))!;
  expect(await capture.evaluate(() => (window as any).syntheticStarts)).toBe(1);
  // Restart restores preferences and data, never recording or reminders.
  await stopApp();
  await launch();
  expect((await state()).preferences.launcherVisible).toBe(false);
  expect(await visible('launcher')).toBe(false);
  expect((await state()).meetings[0].capture).not.toBe('capturing');
  await page.evaluate(() => window.meeting.call('open'));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Show desktop launcher', { exact: true }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => visible('launcher')).toBe(true);
});
test('hidden launcher routes to native adapter: close/failure/expiry are inert; click records once without workspace', async () => {
  await syntheticAudio();
  await preferences({ launcherVisible: false, uiLanguage: 'zh-CN' });
  await signal('closed');
  let system = (await fixture()).notifications;
  expect(system).toHaveLength(1);
  expect(system[0]).toMatchObject({ title: '你可能正在开会', body: '点击开始记录', silent: true });
  expect(await visible('reminder')).toBe(false);
  await fixture({ nativeEvent: 'close' });
  await fixture({ nativeEvent: 'click' });
  expect((await state()).meetings).toHaveLength(0);
  await signal('failed');
  await fixture({ nativeEvent: 'failed' });
  expect((await state()).notificationUnavailable).toBe(true);
  expect(await visible('reminder')).toBe(false);
  await signal('expired', 1, 150);
  await page.waitForTimeout(200);
  await fixture({ nativeEvent: 'click' });
  expect((await state()).meetings).toHaveLength(0);
  await preferences({ uiLanguage: 'en' });
  await signal('clicked');
  system = (await fixture()).notifications;
  expect(system.at(-1).title).toBe('You might be in a meeting');
  await fixture({ nativeEvent: 'click' });
  await fixture({ nativeEvent: 'click' });
  await expect.poll(async () => (await state()).meetings[0]?.capture).toBe('capturing');
  expect((await state()).meetings).toHaveLength(1);
  expect(await visible('workspace')).toBe(false);
});
test('setup exception is explicit; reminder renderer has least privilege; production IPC cannot inject detections', async () => {
  await signal();
  expect(
    (await bubble.evaluate(() => window.meeting.call('command', { type: 'preferences' }))).error,
  ).toBe('PERMISSION_DENIED');
  expect(
    (await page.evaluate(() => window.meeting.call('reminderAccept', { id: 'synthetic-episode' })))
      .ok,
  ).toBe(false);
  await bubble.getByRole('button', { name: /Click to start recording/ }).click();
  await expect(page.getByRole('dialog', { name: 'Meeting audio' })).toBeVisible();
  expect((await state()).meetings).toHaveLength(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  expect((await state()).meetings).toHaveLength(0);
  await stopApp();
  await launch(false);
  const injected = await page.evaluate(() =>
    window.meeting.call('reminderTest', {
      signal: { id: 'injected', revision: 1, present: true, expiresAt: Date.now() + 60000 },
    }),
  );
  expect(injected.error).toBe('PERMISSION_DENIED');
  expect(await visible('reminder')).toBe(false);
});
