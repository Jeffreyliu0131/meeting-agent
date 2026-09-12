/** Validate independent semantic labels and compute their denominators against a frozen run. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { ratio, reviewStatus } from './scoring.mjs';
const [directory, reviewFile] = process.argv.slice(2);
if (!directory || !reviewFile)
  throw Error('Usage: node scripts/evals/review.mjs RUN_DIRECTORY REVIEW_JSON');
const dir = resolve(directory),
  raw = readFileSync(join(dir, 'model.json'));
const run = JSON.parse(raw),
  review = JSON.parse(readFileSync(resolve(reviewFile)));
if (!run.realModel || !run.results?.length) throw Error('NO_REAL_MODEL_EVIDENCE');
const hash = createHash('sha256').update(raw).digest('hex');
const status = reviewStatus(
  review,
  hash,
  run.results.map((x) => x.id),
);
if (review.datasetReviewed !== true) throw Error('CORPUS_LABELS_NOT_HUMAN_REVIEWED');
const fields = [
  'sourceCorrect',
  'sourceTotal',
  'fieldCorrect',
  'fieldTotal',
  'inventedFields',
  'conditionRetained',
  'conditionTotal',
  'unsupportedConflicts',
  'emittedConflicts',
  'irrelevantCollected',
  'collectedFields',
  'targetCorrect',
  'targetTotal',
  'inventedOwnerOrDate',
];
for (const e of review.entries) {
  for (const key of fields)
    if (!Number.isInteger(e[key]) || e[key] < 0)
      throw Error(`UNASSESSED_OR_INVALID_COUNT:${e.id}:${key}`);
  for (const [a, b] of [
    ['sourceCorrect', 'sourceTotal'],
    ['fieldCorrect', 'fieldTotal'],
    ['inventedFields', 'fieldTotal'],
    ['conditionRetained', 'conditionTotal'],
    ['unsupportedConflicts', 'emittedConflicts'],
    ['irrelevantCollected', 'collectedFields'],
    ['targetCorrect', 'targetTotal'],
  ])
    if (e[a] > e[b]) throw Error(`INVALID_DENOMINATOR:${e.id}:${a}`);
}
const sum = (key) => review.entries.reduce((n, e) => n + e[key], 0);
const metrics = {
  sourceAccuracy: ratio(sum('sourceCorrect'), sum('sourceTotal')),
  fieldAccuracy: ratio(sum('fieldCorrect'), sum('fieldTotal')),
  unsupportedFieldRate: ratio(sum('inventedFields'), sum('fieldTotal')),
  conditionRecall: ratio(sum('conditionRetained'), sum('conditionTotal')),
  supportedConflictPrecision: ratio(
    sum('emittedConflicts') - sum('unsupportedConflicts'),
    sum('emittedConflicts'),
  ),
  collectionContamination: ratio(sum('irrelevantCollected'), sum('collectedFields')),
  targetAccuracy: ratio(sum('targetCorrect'), sum('targetTotal')),
  inventedOwnerOrDate: sum('inventedOwnerOrDate'),
};
const thresholdsPass =
  ['sourceAccuracy', 'fieldAccuracy', 'targetAccuracy'].every(
    (k) => metrics[k].value !== null && metrics[k].value >= 0.95,
  ) && metrics.inventedOwnerOrDate === 0;
const result = {
  runHash: hash,
  reviewer: review.reviewer,
  status:
    status.status === 'passed' && thresholdsPass
      ? 'passed'
      : status.status === 'review_required'
        ? 'review_required'
        : 'failed',
  metrics,
  reviewValidation: status,
  policy:
    'Thresholds inherited from collaboration-v1-acceptance; condition/conflict/contamination remain reported diagnostics pending calibration. Human case failures cannot be averaged away.',
};
const output = join(dir, `semantic-score-${Date.now()}.json`);
if (existsSync(output)) throw Error('OUTPUT_EXISTS');
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, output }, null, 2));
if (result.status !== 'passed') process.exitCode = 1;
