import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { extractFile } = require('@electron/asar');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
const sources = () =>
  Object.fromEntries(
    [
      ...files('src'),
      'docs/design/tokens.json',
      'package.json',
      'package-lock.json',
      'scripts/build.mjs',
      'scripts/demo-visual-package-check.mjs',
      'vite.config.ts',
      'tsconfig.json',
    ]
      .sort()
      .map((f) => [f, hash(readFileSync(f))]),
  );
const baselineFile = 'tests/results/demo-live-visuals-build-source.json';
if (process.argv.includes('--capture')) {
  writeFileSync(
    baselineFile,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        sources: sources(),
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Captured source baseline.');
} else {
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
  if (JSON.stringify(baseline.sources) !== JSON.stringify(sources()))
    throw new Error('SOURCE_CHANGED_DURING_BUILD');
  const packages = {};
  for (const [name, path] of Object.entries({
    macOS: 'release/mac-arm64/Meeting Agent.app/Contents/Resources/app.asar',
    Windows: 'release/win-unpacked/resources/app.asar',
  })) {
    const dist = {};
    for (const f of files('dist')) {
      const expected = hash(readFileSync(f)),
        actual = hash(extractFile(path, f));
      if (expected !== actual) throw new Error(name + ': DIST_MISMATCH ' + f);
      dist[f] = actual;
    }
    packages[name] = { path, asar: hash(readFileSync(path)), dist };
  }
  if (packages.macOS.asar !== packages.Windows.asar) throw new Error('PACKAGE_MISMATCH');
  const win = readFileSync('release/win-unpacked/Meeting Agent.exe');
  const mac = readFileSync('release/mac-arm64/Meeting Agent.app/Contents/MacOS/Meeting Agent');
  if (win.readUInt16LE(win.readUInt32LE(0x3c) + 4) !== 0x8664 || mac.readUInt32LE(4) !== 0x0100000c)
    throw new Error('PACKAGE_ARCHITECTURE');
  writeFileSync(
    'tests/results/demo-live-visuals-packages.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        baseline,
        packages,
        architectures: { macOS: 'arm64', Windows: 'x64' },
        runtime: { macOS: 'separate Electron package check', Windows: 'not verified on device' },
      },
      null,
      2,
    ) + '\n',
  );
  console.log('macOS arm64 and Windows x64 packages match every dist file and app.asar.');
}
