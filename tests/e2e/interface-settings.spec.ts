import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { cleanupElectron } from './cleanup';
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
  await cleanupElectron(app, dataDir);
});

test('interface language saves immediately, preserves unrelated drafts and persists across restart', async () => {
  await launch();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const motion = page.locator('#settings-experience input[type=checkbox]').first();
  await motion.check();
  await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  await expect(motion).toBeChecked();
  let state = await snapshot();
  expect(state.preferences.uiLanguage).toBe('zh-CN');
  expect(state.preferences.reduceMotion).toBe(false);
  expect(state.preferences.audio.setupCompleted).toBe(false);
  expect(state.preferences.defaultOutputLocale).toBe('en');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
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

test('language persistence failure stays visible in settings and permits retry without losing drafts', async () => {
  await launch();
  const db = new DatabaseSync(join(dataDir, 'meetings.sqlite'));
  try {
    db.exec(
      "CREATE TRIGGER reject_settings BEFORE UPDATE ON state BEGIN SELECT RAISE(FAIL, 'synthetic storage failure'); END;",
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#settings-experience input[type=checkbox]').first().check();
    await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN');
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByLabel('Interface language', { exact: true })).toHaveValue('system');
    await expect(page.locator('#settings-experience input[type=checkbox]').first()).toBeChecked();
    db.exec('DROP TRIGGER reject_settings');
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
