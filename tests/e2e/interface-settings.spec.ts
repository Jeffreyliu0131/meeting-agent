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
import { DatabaseSync } from 'node:sqlite';

let app: ElectronApplication, page: Page, dataDir: string;
async function launch(native = false) {
  const env = {
    ...process.env,
    MEETING_DATA_DIR: dataDir,
    MEETING_SYSTEM_LOCALE: 'en',
    OPENAI_API_KEY: '',
    MEETING_STT_API_KEY: '',
  };
  if (native) delete (env as Record<string, string | undefined>).MEETING_SYSTEM_LOCALE;
  app = await electron.launch({ args: [resolve('.')], env });
  await expect
    .poll(async () => {
      page = (await app.windows()).find((p) => p.url().includes('role=workspace'))!;
      return !!page;
    })
    .toBe(true);
  await expect
    .poll(async () => page.evaluate(async () => (await window.meeting?.call('snapshot'))?.ok))
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('role=workspace'),
    );
    w?.show();
    w?.focus();
  });
}
const snapshot = () => page.evaluate(async () => (await window.meeting.call('snapshot')).value);
test.beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'meeting-interface-'));
});
test.afterEach(async () => {
  if (app && app.process().exitCode === null) {
    const closed = app.waitForEvent('close', { timeout: 10000 });
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await closed;
  }
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
});

test('settings save immediately, preserve independent changes and persist across restart', async () => {
  await launch();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const motion = page.locator('#settings-experience input[name=reduceMotion]');
  await motion.check();
  await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  await expect(motion).toBeChecked();
  let state = await snapshot();
  expect(state.preferences.uiLanguage).toBe('zh-CN');
  expect(state.preferences.reduceMotion).toBe(true);
  expect(state.preferences.audio.setupCompleted).toBe(false);
  expect(state.preferences.defaultOutputLocale).toBe('en');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  state = await snapshot();
  expect(state.preferences.uiLanguage).toBe('zh-CN');
  expect(state.preferences.reduceMotion).toBe(true);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#settings-language select').first().selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('#settings-language select').first().selectOption('system');
  await expect.poll(async () => (await snapshot()).preferences.uiLanguage).toBe('system');
  await page.locator('#settings-language select').first().selectOption('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await app.evaluate(({ app }) => app.exit(0));
  await launch();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect((await snapshot()).preferences.uiLanguage).toBe('zh-CN');
});

test('failed immediate settings roll back honestly and can be retried', async () => {
  await launch();
  const db = new DatabaseSync(join(dataDir, 'meetings.sqlite'));
  try {
    db.exec(
      "CREATE TRIGGER reject_settings BEFORE UPDATE ON state BEGIN SELECT RAISE(FAIL, 'synthetic storage failure'); END;",
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#settings-experience input[name=reduceMotion]').check();
    await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN');
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByLabel('Interface language', { exact: true })).toHaveValue('system');
    await expect(page.locator('#settings-experience input[name=reduceMotion]')).not.toBeChecked();
    db.exec('DROP TRIGGER reject_settings');
    await page.locator('#settings-experience input[name=reduceMotion]').check();
    await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  } finally {
    db.close();
  }
});

test('native preferred system language drives startup; chrome does not select and modal skips collapsed controls', async () => {
  await launch(true);
  const languages = await app.evaluate(({ app }) => ({
    application: app.getLocale(),
    preferred: app.getPreferredSystemLanguages(),
  }));
  const expected = /^zh(?:[-_]|$)/i.test(languages.preferred[0] ?? languages.application)
    ? 'zh-CN'
    : 'en';
  await expect(page.locator('html')).toHaveAttribute('lang', expected);
  expect((await snapshot()).preferences.uiLocale).toBe(expected);
  writeFileSync(
    test.info().outputPath('native-language.json'),
    JSON.stringify({ ...languages, resolved: expected }, null, 2),
  );
  const settings = expected === 'zh-CN' ? '设置' : 'Settings';
  await page.getByRole('button', { name: settings, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = dialog.locator('h2').first();
  await expect(title).toHaveCSS('user-select', 'none');
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await expect(page.locator('#settings-experience input').last()).toHaveCSS('user-select', 'text');
  const close = dialog.locator('.modal-title button');
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator('.settings-footer button')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.locator('#settings-language select').first().focus();
  await expect(page.locator('#settings-language select').first()).toHaveCSS(
    'outline-style',
    'solid',
  );
  await page.screenshot({ path: test.info().outputPath('settings-native.png') });
});

test('launcher and display switches apply immediately without Done; rapid changes survive reopening', async () => {
  await launch();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const launcher = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('role=launcher'))
        ?.isVisible(),
    );
  await page.getByLabel('Show desktop launcher', { exact: true }).uncheck();
  await expect.poll(launcher).toBe(false);
  expect((await snapshot()).preferences.launcherVisible).toBe(false);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Show desktop launcher', { exact: true }).check();
  await expect.poll(launcher).toBe(true);
  await page.locator('#settings-experience input[name=reduceMotion]').check();
  await page.getByLabel('Remind me when a meeting is detected', { exact: true }).uncheck();
  await page
    .getByLabel('Show desktop launcher', { exact: true })
    .evaluate((input: HTMLInputElement) => {
      input.click();
      input.click();
      input.click();
    });
  await expect.poll(async () => (await snapshot()).preferences.launcherVisible).toBe(false);
  await expect.poll(async () => (await snapshot()).preferences.reduceMotion).toBe(true);
  expect((await snapshot()).preferences.meetingReminders).toBe(false);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Show desktop launcher', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toHaveCount(0);
  await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN');
  await expect(page.getByText('更改会自动保存。', { exact: true })).toBeVisible();
  await page.getByLabel('显示桌面悬浮球', { exact: true }).check();
  await expect.poll(launcher).toBe(true);
  await page.screenshot({ path: test.info().outputPath('settings-autosave-zh.png') });
});

test('failed launcher save reverts its checkbox and native window; retry applies the intent', async () => {
  await launch();
  const db = new DatabaseSync(join(dataDir, 'meetings.sqlite'));
  try {
    db.exec(
      "CREATE TRIGGER reject_settings BEFORE UPDATE ON state BEGIN SELECT RAISE(FAIL, 'synthetic storage failure'); END;",
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const checkbox = page.getByLabel('Show desktop launcher', { exact: true });
    await checkbox.uncheck();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expect(checkbox).toBeChecked();
    expect((await snapshot()).preferences.launcherVisible).toBe(true);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('role=launcher'))
          ?.isVisible(),
      ),
    ).toBe(true);
    db.exec('DROP TRIGGER reject_settings');
    await page.getByRole('dialog').getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(checkbox).not.toBeChecked();
    await expect.poll(async () => (await snapshot()).preferences.launcherVisible).toBe(false);
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  } finally {
    db.close();
  }
});

test('shortcut auto-save rolls back native registration when persistence fails', async () => {
  await launch();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const input = page.locator('#settings-experience input').last();
  const old = 'CommandOrControl+Shift+F9',
    next = 'CommandOrControl+Shift+F10';
  await input.fill(old);
  await expect.poll(async () => (await snapshot()).preferences.shortcut).toBe(old);
  const db = new DatabaseSync(join(dataDir, 'meetings.sqlite'));
  try {
    db.exec(
      "CREATE TRIGGER reject_settings BEFORE UPDATE ON state BEGIN SELECT RAISE(FAIL, 'synthetic storage failure'); END;",
    );
    await input.fill(next);
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    expect((await snapshot()).preferences.shortcut).toBe(old);
    const registered = await app.evaluate(
      ({ globalShortcut }, keys) => keys.map((key) => globalShortcut.isRegistered(key)),
      [old, next],
    );
    expect(registered).toEqual([true, false]);
    await expect(input).toHaveValue(old);
    db.exec('DROP TRIGGER reject_settings');
    await input.fill(next);
    await expect.poll(async () => (await snapshot()).preferences.shortcut).toBe(next);
    expect(
      await app.evaluate(
        ({ globalShortcut }, keys) => keys.map((key) => globalShortcut.isRegistered(key)),
        [old, next],
      ),
    ).toEqual([false, true]);
  } finally {
    db.close();
  }
});
