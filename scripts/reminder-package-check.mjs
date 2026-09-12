import { _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { extractFile } from '@electron/asar';

const resultDir = resolve('tests/results');
const prefix = process.env.MEETING_CHECK_PREFIX || 'meeting-reminder';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
const packages = {
  macOS: 'release/mac-arm64/Meeting Agent.app/Contents/Resources/app.asar',
  Windows: 'release/win-unpacked/resources/app.asar',
};
const hashes = {};
for (const [platform, asar] of Object.entries(packages)) {
  hashes[platform] = { asarSha256: hash(readFileSync(asar)), files: {} };
  for (const file of files('dist')) {
    const actual = hash(extractFile(asar, file));
    if (actual !== hash(readFileSync(file))) throw new Error(`${platform} mismatch: ${file}`);
    hashes[platform].files[file] = actual;
  }
}
if (hashes.macOS.asarSha256 !== hashes.Windows.asarSha256)
  throw new Error('Cross-platform app.asar mismatch');
const sourceHashes = {};
for (const file of [
  ...files('src'),
  ...files('tests/unit'),
  ...files('tests/e2e'),
  'docs/design/ui-copy.json',
  'docs/design/tokens.json',
  'package.json',
  'package-lock.json',
  'scripts/build.mjs',
  'vite.config.ts',
  'tsconfig.json',
]) {
  sourceHashes[file] = hash(readFileSync(file));
}
writeFileSync(
  join(resultDir, `${prefix}-packages.json`),
  JSON.stringify({ ranAt: new Date().toISOString(), packages: hashes, sourceHashes }, null, 2) +
    '\n',
);
const dataDir = mkdtempSync(join(tmpdir(), 'meeting-reminder-package-'));
let app;
try {
  app = await electron.launch({
    executablePath: resolve('release/mac-arm64/Meeting Agent.app/Contents/MacOS/Meeting Agent'),
    args: [],
    env: {
      ...process.env,
      MEETING_DATA_DIR: dataDir,
      MEETING_SYSTEM_LOCALE: 'zh-CN',
      OPENAI_API_KEY: '',
      MEETING_STT_API_KEY: '',
      MEETING_DEV_INPUTS: '1',
      MEETING_REMINDER_TEST: '1',
    },
  });
  let page;
  for (let attempt = 0; attempt < 80; attempt++) {
    page = (await app.windows()).find((p) => p.url().includes('role=workspace'));
    try {
      if (page && (await page.evaluate(() => window.meeting?.call('snapshot')))?.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!page) throw new Error('Packaged workspace missing');
  const snapshot = (await page.evaluate(() => window.meeting.call('snapshot'))).value;
  if (snapshot.meetings.length !== 0 || snapshot.preferences.uiLocale !== 'zh-CN')
    throw new Error('Invalid isolated startup');
  const injection = await page.evaluate(() =>
    window.meeting.call('reminderTest', {
      signal: {
        id: 'synthetic-package-denied',
        revision: 1,
        present: true,
        expiresAt: Date.now() + 60000,
      },
    }),
  );
  if (injection.error !== 'PERMISSION_DENIED')
    throw new Error('Packaged test injection was enabled');
  await page.evaluate(() => window.meeting.call('open'));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  for (const [locale, launcherLabel, reminderLabel] of [
    ['zh-CN', '显示桌面悬浮球', '发现会议时提醒我'],
    ['en', 'Show desktop launcher', 'Remind me when a meeting is detected'],
  ]) {
    await page.locator('#settings-language select').first().selectOption(locale);
    await page.getByLabel(launcherLabel, { exact: true }).waitFor();
    await page.getByLabel(reminderLabel, { exact: true }).waitFor();
    await page.locator('#settings-experience').scrollIntoViewIfNeeded();
    await page.waitForFunction((locale) => document.documentElement.lang === locale, locale);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });

    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('role=workspace'))
          .webContents.capturePage()
      )
        .toPNG()
        .toString('base64'),
    );
    writeFileSync(join(resultDir, `${prefix}-package-${locale}.png`), Buffer.from(png, 'base64'));
  }
  await page.getByLabel('Show desktop launcher', { exact: true }).uncheck();
  await page.waitForFunction(
    async () => (await window.meeting.call('snapshot')).value.preferences.launcherVisible === false,
  );
  const visible = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('role=launcher'))
      ?.isVisible(),
  );
  if (visible) throw new Error('Packaged launcher did not hide immediately');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const final = (await page.evaluate(() => window.meeting.call('snapshot'))).value;
  if (final.meetings.length !== 0) throw new Error('Unexpected capture');
  const result = {
    ranAt: new Date().toISOString(),
    platform: 'macOS arm64',
    packaged: true,
    locales: ['zh-CN', 'en'],
    hiddenLauncher: true,
    immediateLauncherToggle: true,
    testInjectionDenied: true,
    meetings: 0,
    realAudioCaptured: false,
    productionDetectorConnected: false,
    realNativeNotificationDelivery: 'not verified; signing/OS setup required',
  };
  writeFileSync(
    join(resultDir, `${prefix}-package-smoke.json`),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      ...result,
      identicalDistFiles: Object.keys(hashes.macOS.files).length,
      appAsarIdentical: true,
    }),
  );
} finally {
  if (app && app.process().exitCode === null) {
    const closed = app.waitForEvent('close');
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await closed;
  }
  rmSync(dataDir, { recursive: true, force: true });
}
