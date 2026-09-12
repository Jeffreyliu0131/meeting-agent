/** Verify both daily packages, then inspect Mac using only a local editorial-synthetic test fixture. Run editorial.spec.ts first. */
import { createRequire } from 'node:module';
import {
  readdirSync,
  statSync,
  existsSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const require = createRequire(resolve('package.json'));
const { _electron: electron, expect } = require('@playwright/test');
const { extractFile } = require('@electron/asar');
const { createHash } = await import('node:crypto');
const { execFileSync } = await import('node:child_process');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const packages = {
  macOS: 'release/mac-arm64/Meeting Agent.app/Contents/Resources/app.asar',
  Windows: 'release/win-unpacked/resources/app.asar',
};
const manifest = {
  ranAt: new Date().toISOString(),
  baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  packages: {},
  sourceHashes: {},
};
for (const [platform, asar] of Object.entries(packages)) {
  const record = { asarSha256: hash(readFileSync(asar)), files: {} };
  for (const file of files('dist')) {
    const expected = hash(readFileSync(file)),
      actual = hash(extractFile(asar, file));
    if (expected !== actual) throw new Error(`${platform} mismatch: ${file}`);
    record.files[file] = actual;
  }
  manifest.packages[platform] = record;
}
if (manifest.packages.macOS.asarSha256 !== manifest.packages.Windows.asarSha256)
  throw new Error('App asar mismatch');
const win = readFileSync('release/win-unpacked/Meeting Agent.exe'),
  mac = readFileSync('release/mac-arm64/Meeting Agent.app/Contents/MacOS/Meeting Agent');
if (win.readUInt16LE(win.readUInt32LE(0x3c) + 4) !== 0x8664 || mac.readUInt32LE(4) !== 0x0100000c)
  throw new Error('Wrong package architecture');
manifest.architectures = { Windows: 'x64', macOS: 'arm64' };
for (const file of [
  ...files('src'),
  ...files('tests/unit'),
  ...files('tests/e2e'),
  'docs/design/tokens.json',
  'docs/design/ui-copy.json',
  'package.json',
  'package-lock.json',
  'scripts/build.mjs',
  'scripts/editorial-package-check.mjs',
  'vite.config.ts',
  'tsconfig.json',
])
  manifest.sourceHashes[file] = hash(readFileSync(file));
writeFileSync(
  'tests/results/meeting-editorial-packages.json',
  JSON.stringify(manifest, null, 2) + '\n',
);
const root = tmpdir();
const candidates = readdirSync(root)
  .filter((n) => n.startsWith('editorial-synthetic-'))
  .map((n) => join(root, n))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
let seed;
for (const dir of candidates) {
  const file = join(dir, 'meetings.sqlite');
  if (!existsSync(file)) continue;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT payload FROM state WHERE id=1').get();
    if (!row) continue;
    const state = JSON.parse(row.payload);
    if (
      state.meetings.length === 1 &&
      state.meetings[0].title.includes('合成演示') &&
      state.meetings[0].mode === 'manual' &&
      state.meetings[0].segments.length === 3 &&
      state.meetings[0].artifacts.length
    ) {
      seed = state;
      break;
    }
  } finally {
    db.close();
  }
}
if (!seed) throw new Error('Expected isolated synthetic fixture unavailable');
seed.preferences.uiLanguage = 'zh-CN';
seed.meetings[0].status = 'active';
seed.meetings[0].capture = 'paused';
seed.preferences.launcherVisible = false;
const dir = mkdtempSync(join(root, 'editorial-package-preview-'));
const db = new DatabaseSync(join(dir, 'meetings.sqlite'));
db.exec(
  'CREATE TABLE state (id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, payload TEXT NOT NULL)',
);
db.prepare('INSERT INTO state VALUES(1,1,?)').run(JSON.stringify(seed));
db.close();
const app = await electron.launch({
  executablePath: resolve('release/mac-arm64/Meeting Agent.app/Contents/MacOS/Meeting Agent'),
  args: [],
  env: {
    ...process.env,
    MEETING_DATA_DIR: dir,
    MEETING_SYSTEM_LOCALE: 'zh-CN',
    OPENAI_API_KEY: '',
    MEETING_STT_API_KEY: '',
    MEETING_DEV_INPUTS: '',
  },
});
let cdp;
try {
  let page;
  await expect
    .poll(async () => {
      page = (await app.windows()).find((p) => p.url().includes('role=workspace'));
      return !!page;
    })
    .toBe(true);
  await page.waitForFunction(() => !!window.meeting);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('role=workspace'),
    );
    w.show();
  });
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1488,
    height: 1056,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.locator('.meeting-row').first().click();
  const source = page
    .getByRole('row')
    .filter({ hasText: '支持条件' })
    .getByRole('button', { name: '查看来源', exact: true });
  await expect(source).toHaveText('[2]');
  await source.click();
  await page.getByRole('dialog').getByRole('button', { name: '查看全部转写' }).click();
  await expect(page.getByRole('dialog').locator('blockquote')).toHaveCount(3);
  await expect.poll(() => page.locator('.expression-changed').count()).toBe(0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ scale: 'css', path: 'tests/results/meeting-editorial/mac-package.png' });
  const snapshot = (await page.evaluate(() => window.meeting.call('snapshot'))).value;
  const result = {
    ranAt: new Date().toISOString(),
    packaged: true,
    platform: 'macOS arm64',
    synthetic: true,
    realAudio: false,
    modelConfigured: snapshot.capabilities.modelConfigured,
    developerInputs: snapshot.capabilities.developerInputs,
    capture: snapshot.meetings[0].capture,
    sourceCount: await page.getByRole('dialog').locator('blockquote').count(),
    sourcePanel: await page.getByRole('dialog').boundingBox(),
  };
  if (result.modelConfigured || result.developerInputs || result.capture === 'capturing')
    throw new Error('Unexpected production activity');
  writeFileSync(
    'tests/results/meeting-editorial-package-smoke.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
} finally {
  const owned = await app
    .evaluate(({ app }) => app.getAppMetrics().map((metric) => metric.pid))
    .catch(() => []);
  const child = app.process();
  for (const pid of new Set([child.pid, ...owned])) {
    if (!pid || pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true);
}
