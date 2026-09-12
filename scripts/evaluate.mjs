#!/usr/bin/env node
/** One-shot evaluations, no scheduler, no daily app changes, no device capture. */
import { spawn, execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  constants,
  appendFileSync,
  existsSync,
  mkdtempSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, platform, arch } from 'node:os';
import { validateCorpus, releaseGate } from './evals/scoring.mjs';
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowed = new Set(['--offline', '--model', '--release', '--help']);
if (args.some((a) => !allowed.has(a))) throw Error('Unknown option; use --help');
if (args.includes('--help')) {
  console.log(
    'node scripts/evaluate.mjs [--offline] [--model] [--release]\nDefault: isolated unit + evaluator tests + build + Electron + stream + local package inspection.\n--model: additionally run 60 synthetic text events through configured real model, max 240 calls / 1M observed tokens by default.\n--release: exit 2 unless every product gate has evidence.\nResults and source snapshot: a new .cache/evals run. No overwrite of daily app or previous reports.',
  );
  process.exit(0);
}
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(root, '.cache/evals', runId);
mkdirSync(out, { recursive: true });
const snapshot = mkdtempSync(join(tmpdir(), 'meeting-evals-'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : [],
  );
const trackedRoots = [
  'src',
  'public',
  'scripts',
  'tests/unit',
  'tests/e2e',
  'tests/fixtures',
  'tests/evals',
];
const configFiles = [
  'index.html',
  'capture.html',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.evals.json',
  'vite.config.ts',
  'playwright.config.ts',
  'docs/design/tokens.json',
];
const inputFiles = [
  ...trackedRoots.flatMap((p) => (existsSync(join(root, p)) ? walk(join(root, p)) : [])),
  ...configFiles.filter((p) => existsSync(join(root, p))).map((p) => join(root, p)),
].sort();
const manifest = inputFiles.map((path) => ({
  path: relative(root, path).split('\\').join('/'),
  sha256: sha(readFileSync(path)),
}));
const git = (...a) => {
  try {
    return execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};
const provenance = {
  runId,
  startedAt: new Date().toISOString(),
  platform: platform(),
  arch: arch(),
  node: process.version,
  head: git('rev-parse', 'HEAD'),
  dirtyFiles: git('status', '--short'),
  sourceSha256: sha(JSON.stringify(manifest)),
  corpusSha256: sha(readFileSync(join(root, 'tests/evals/events.json'))),
  files: manifest,
};
for (const file of inputFiles) {
  const dest = join(snapshot, relative(root, file));
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(file, dest);
}
// Documentation is read by static architectural tests. Never copy configuration secrets, Git history, packages or user data.
for (const file of walk(join(root, 'docs')).filter((p) => ['.md', '.json'].includes(extname(p)))) {
  const dest = join(snapshot, relative(root, file));
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(file, dest);
}
for (const p of ['README.md', 'AGENTS.md']) copyFileSync(join(root, p), join(snapshot, p));
// Copy-on-write where available: real dependency paths produce reproducible bundles.
// A node_modules symlink would embed the source checkout path in esbuild's module IDs.
cpSync(join(root, 'node_modules'), join(snapshot, 'node_modules'), {
  recursive: true,
  dereference: false,
  verbatimSymlinks: true,
  mode: constants.COPYFILE_FICLONE,
});
const copiedManifest = manifest.map((x) => ({
  path: x.path,
  sha256: sha(readFileSync(join(snapshot, x.path))),
}));
if (sha(JSON.stringify(copiedManifest)) !== provenance.sourceSha256)
  throw Error('WORKSPACE_CHANGED_DURING_SNAPSHOT');
json(join(out, 'provenance.json'), provenance);
console.log(
  `Evaluation evidence: ${out}\nSnapshot: ${snapshot}\nHEAD: ${provenance.head}\nSource SHA256: ${provenance.sourceSha256}`,
);
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^(OPENAI_|MEETING_)/.test(k) && !/(API_KEY|TOKEN|SECRET|PASSWORD)/.test(k),
  ),
);
Object.assign(cleanEnv, {
  OPENAI_API_KEY: '',
  MEETING_STT_API_KEY: '',
  MEETING_API_BASE: 'https://example.invalid',
  MEETING_STT_API_BASE: 'https://example.invalid',
});
const checks = [];
async function command(id, commandArgs, timeoutMs = 180000, extraEnv = {}) {
  console.log(`START ${id}`);
  const start = performance.now();
  let output = '',
    timedOut = false,
    child;
  const code = await new Promise((done) => {
    child = spawn(process.execPath, commandArgs, {
      cwd: snapshot,
      env: { ...cleanEnv, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (x) => {
      output += x;
      appendFileSync(join(out, `${id}.txt`), x);
    });
    child.stderr.on('data', (x) => {
      output += x;
      appendFileSync(join(out, `${id}.txt`), x);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    const forceTimer = setTimeout(() => child.kill('SIGKILL'), timeoutMs + 5000);
    child.on('error', (e) => {
      output += e.code ?? 'SPAWN_ERROR';
      clearTimeout(timer);
      clearTimeout(forceTimer);
      done(-1);
    });
    child.on('close', (c) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      done(c ?? -1);
    });
  });
  writeFileSync(join(out, `${id}.txt`), output);
  const result = {
    id,
    status: code === 0 && !timedOut ? 'passed' : 'failed',
    exitCode: code,
    timedOut,
    durationMs: Math.round(performance.now() - start),
    command: [process.execPath, ...commandArgs],
    evidence: `${id}.txt`,
  };
  checks.push(result);
  console.log(`END ${id}: ${result.status} (${result.durationMs} ms)`);
  json(join(out, 'progress.json'), checks);
  return result;
}
const corpus = JSON.parse(readFileSync(join(snapshot, 'tests/evals/events.json')));
const corpusErrors = validateCorpus(corpus);
checks.push({
  id: 'corpus',
  status: corpusErrors.length ? 'failed' : 'passed',
  cases: corpus.cases.length,
  events: corpus.events.length,
  errors: corpusErrors,
  semanticCasesPassed: 0,
});
await command('scorer', ['--import', 'tsx', '--test', 'tests/evals/scoring.test.mjs']);
const unit = await command('unit', [
  '--import',
  'tsx',
  '--test',
  '--test-reporter=tap',
  ...readdirSync(join(snapshot, 'tests/unit'))
    .filter((x) => x.endsWith('.test.ts'))
    .map((x) => 'tests/unit/' + x),
]);
const unitText = readFileSync(join(out, 'unit.txt'), 'utf8');
unit.counts = Object.fromEntries(
  ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'].map((k) => [
    k,
    Number(unitText.match(new RegExp(`# ${k} (\\d+)`))?.[1] ?? 0),
  ]),
);
if (!unit.counts.tests || unit.counts.skipped || unit.counts.cancelled || unit.counts.todo)
  unit.status = 'failed';
await command('eval-adapter-types', [
  'node_modules/typescript/bin/tsc',
  '--noEmit',
  '-p',
  'tsconfig.evals.json',
]);
const typecheck = await command('typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']);
let buildPassed = false;
if (typecheck.status === 'passed') {
  const main = await command('build-main', ['scripts/build.mjs']);
  const ui = await command('build-ui', ['node_modules/vite/bin/vite.js', 'build']);
  buildPassed = main.status === 'passed' && ui.status === 'passed';
}
if (buildPassed) {
  const e2e = await command('electron', ['node_modules/@playwright/test/cli.js', 'test'], 1200000, {
    MEETING_E2E_REPORT: join(out, 'electron.json'),
    MEETING_E2E_OUTPUT: join(out, 'electron-artifacts'),
  });
  if (existsSync(join(out, 'electron.json'))) {
    const report = JSON.parse(readFileSync(join(out, 'electron.json')));
    e2e.counts = report.stats;
    if (
      !report.stats.expected ||
      report.stats.skipped ||
      report.stats.flaky ||
      report.stats.unexpected
    )
      e2e.status = 'failed';
  } else e2e.status = 'failed';
} else checks.push({ id: 'electron', status: 'blocked', reason: 'Build did not pass' });
await command('stream', ['--import', 'tsx', 'scripts/stream-eval.ts']);
const streamPath = join(snapshot, 'tests/results/stream-evaluation.json');
if (existsSync(streamPath)) copyFileSync(streamPath, join(out, 'stream.json'));
const packages = {
  id: 'package-content',
  status: 'not_run',
  sourceMatched: false,
  platformRunVerified: false,
  paths: {
    mac: join(root, 'release/mac-arm64/Meeting Agent.app/Contents/Resources/app.asar'),
    windows: join(root, 'release/win-unpacked/resources/app.asar'),
  },
};
try {
  if (buildPassed && Object.values(packages.paths).every(existsSync)) {
    const asar = require('@electron/asar');
    packages.hashes = Object.fromEntries(
      Object.entries(packages.paths).map(([k, p]) => [k, sha(readFileSync(p))]),
    );
    packages.sameArchive = packages.hashes.mac === packages.hashes.windows;
    packages.files = walk(join(snapshot, 'dist')).map((file) => {
      const name = relative(snapshot, file).split('\\').join('/');
      const expected = sha(readFileSync(file));
      return {
        name,
        expected,
        ...Object.fromEntries(
          Object.entries(packages.paths).map(([key, p]) => {
            try {
              return [key, sha(asar.extractFile(p, name))];
            } catch {
              return [key, null];
            }
          }),
        ),
      };
    });
    packages.sourceMatched = packages.files.every(
      (x) => x.expected === x.mac && x.expected === x.windows,
    );
    packages.status = packages.sameArchive && packages.sourceMatched ? 'passed' : 'failed';
  } else packages.reason = 'Packages missing or build unavailable';
} catch (e) {
  packages.status = 'failed';
  packages.reason = e.code ?? 'PACKAGE_INSPECTION_ERROR';
}
json(join(out, 'packages.json'), packages);
checks.push(packages);
let model = {
  id: 'model',
  status: 'not_run',
  actualCalls: 0,
  reason: 'Run with --model to evaluate real semantics',
};
if (args.includes('--model')) {
  const dotenv = require('dotenv');
  const local = existsSync(join(root, '.env'))
    ? dotenv.parse(readFileSync(join(root, '.env')))
    : {};
  const providerEnv = Object.fromEntries(
    Object.entries({ ...local, ...process.env }).filter(([k]) => /^(OPENAI_|MEETING_)/.test(k)),
  );
  if (!providerEnv.OPENAI_API_KEY)
    model = { id: 'model', status: 'blocked', actualCalls: 0, reason: 'MODEL_NOT_CONFIGURED' };
  else {
    await command(
      'model-execution',
      ['--import', 'tsx', 'scripts/evals/model.ts', out],
      14400000,
      providerEnv,
    );
    model = { id: 'model', ...JSON.parse(readFileSync(join(out, 'model.json'))) };
  }
}
if (!existsSync(join(out, 'model.json'))) json(join(out, 'model.json'), model);
checks.push({
  id: 'model',
  status: model.status,
  reason: model.reason,
  actualCalls: model.actualCalls,
});
const human = {
  id: 'semantic-human-review',
  status: 'review_required',
  reason:
    'Agent-authored corpus and real model meaning must be independently reviewed; schema/label checks alone are insufficient',
};
const mandatory = [
  human,
  {
    id: 'audio-offline',
    status: 'not_run',
    reason: '3-person microphone and overlap evidence unavailable',
  },
  { id: 'audio-online', status: 'not_run', reason: 'Local and remote tracks not measured' },
  { id: 'windows-runtime', status: 'not_run', reason: 'No Windows hardware session in this run' },
  {
    id: 'native-notifications',
    status: 'blocked',
    reason: 'Actual detector absent; native delivery needs each OS evidence',
  },
  {
    id: 'collaboration-export',
    status: 'blocked',
    reason:
      'Raw JSON includes collaboration; unified decision closeout and dedicated export acceptance are not yet verified',
  },
  {
    id: 'bilingual-collaboration-a11y',
    status: 'not_run',
    reason: 'Complete bilingual forms and screen-reader evaluation outstanding',
  },
  {
    id: 'user-comprehension',
    status: 'not_run',
    reason: 'No human comprehension/time/disruption measurements',
  },
];
const currentFiles = [
  ...trackedRoots.flatMap((p) => (existsSync(join(root, p)) ? walk(join(root, p)) : [])),
  ...configFiles.filter((p) => existsSync(join(root, p))).map((p) => join(root, p)),
].sort();
const currentManifest = currentFiles.map((path) => ({
  path: relative(root, path).split('\\').join('/'),
  sha256: sha(readFileSync(path)),
}));
const sourceChanged = sha(JSON.stringify(currentManifest)) !== provenance.sourceSha256;
checks.push({
  id: 'source-stability',
  status: sourceChanged ? 'failed' : 'passed',
  reason: sourceChanged
    ? 'Workspace changed; results apply only to captured snapshot'
    : 'Original input files unchanged during run',
});
const selected = checks.filter((x) => !['model', 'package-content'].includes(x.id));
const streamResult = existsSync(join(out, 'stream.json'))
  ? JSON.parse(readFileSync(join(out, 'stream.json')))
  : null;
const metricDefinitions = JSON.parse(
  readFileSync(join(snapshot, 'tests/evals/metrics.json')),
).metrics;
const observations = metricDefinitions.map((metric) => {
  const base = {
    id: metric.id,
    name: metric.name,
    status: 'not_measured',
    definition: metric.definition,
    threshold: metric.threshold,
    evidenceRequired: metric.evidence,
    value: null,
  };
  if (metric.id === 'M29')
    return {
      ...base,
      status: checks.some((c) => c.status === 'failed') ? 'failed' : 'measured_program_only',
      value: {
        unit: unit.counts,
        electron: checks.find((c) => c.id === 'electron')?.counts,
        scorer: checks.find((c) => c.id === 'scorer')?.status,
      },
    };
  if (metric.id === 'M25' && streamResult)
    return { ...base, status: 'measured_synthetic_only', value: streamResult };
  if (metric.id === 'M27')
    return {
      ...base,
      status: packages.status === 'passed' ? 'package_content_only' : packages.status,
      value: {
        sameArchive: packages.sameArchive,
        sourceMatched: packages.sourceMatched,
        windowsRuntime: false,
      },
    };
  if (['M04', 'M05', 'M17', 'M18', 'M21', 'M22'].includes(metric.id))
    return {
      ...base,
      status:
        model.status === 'blocked'
          ? 'blocked'
          : model.metrics
            ? 'measured_model_only'
            : 'not_measured',
      value: model.metrics
        ? {
            M04: model.metrics.family,
            M05: model.metrics.operation,
            M17: { p95: model.metrics.understandingP95Ms, n: model.metrics.understandingSamples },
            M18: model.results?.flatMap((r) => (r.checkpoints ?? []).map((p) => p.timeToSettledMs)),
            M21: {
              calls: model.actualCalls,
              tokens: model.observedTokens,
              accountingComplete: model.tokenAccountingComplete,
            },
            M22: model.currencyCost,
          }[metric.id]
        : null,
    };
  return base;
});
json(join(out, 'metric-observations.json'), {
  scope:
    'Unmeasured metrics are deliberately not green; test-file passes do not substitute for exact metric observations.',
  observations,
});
const requirements = JSON.parse(
  readFileSync(join(snapshot, 'tests/evals/requirements.json')),
).requirements;
json(join(out, 'requirement-coverage.json'), {
  totalMapped: requirements.length,
  totalFullyVerified: null,
  policy: 'Routing only; no invented 100% acceptance coverage.',
  requirements,
});
const report = {
  schemaVersion: 1,
  provenance: { ...provenance, files: undefined },
  completedAt: new Date().toISOString(),
  snapshot,
  checks,
  metricsEvidence: 'metric-observations.json',
  requirementEvidence: 'requirement-coverage.json',
  requiredProductEvidence: mandatory,
  automatedStatus: releaseGate(selected),
  productGate: releaseGate([...checks, ...mandatory]),
  evidencePolicy:
    'Program doubles, real model, synthetic/real audio and each OS are separate. Mapped requirements are not proven coverage. No test result implies a successful deployed product.',
};
json(join(out, 'report.json'), report);
const rows = [...checks, ...mandatory]
  .map(
    (c) =>
      `| ${c.id} | ${c.status} | ${c.reason ?? (c.counts ? JSON.stringify(c.counts) : '见对应JSON／日志')} |`,
  )
  .join('\n');
writeFileSync(
  join(out, 'report.md'),
  `# Event / eval execution\n\nRun: ${runId}. HEAD: ${provenance.head}. Source SHA256: ${provenance.sourceSha256}.\n\n自动检查：${report.automatedStatus.status}。完整产品门槛：${report.productGate.status}，ready=${report.productGate.ready}。\n\n| 检查 | 状态 | 依据／边界 |\n|---|---|---|\n${rows}\n\n语义案例60条，当前通过数必须从真实模型及人工结果读取。合成负载不是实际设备30分钟运行。所有日志在本目录，快照在 ${snapshot}。\n`,
);
console.log(
  `Report: ${join(out, 'report.md')}\nAutomated checks: ${report.automatedStatus.status}\nProduct ready: ${report.productGate.ready}`,
);
if (checks.some((x) => x.status === 'failed')) process.exitCode = 1;
else if (args.includes('--release') && !report.productGate.ready) process.exitCode = 2;
