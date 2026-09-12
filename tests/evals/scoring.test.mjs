import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ratio,
  quantile,
  classification,
  releaseGate,
  reviewStatus,
  intentLabels,
  validateCorpus,
} from '../../scripts/evals/scoring.mjs';
test('empty denominators and absent samples cannot create perfect scores', () => {
  assert.equal(ratio(0, 0).value, null);
  assert.equal(quantile([]), null);
  assert.equal(classification([]).macroF1, null);
  assert.equal(releaseGate([]).ready, false);
});
test('failed model calls count as missed positives and cannot be silently dropped', () => {
  const m = classification([
    { expected: ['poll/prepare'], actual: ['poll/prepare'] },
    { expected: ['poll/prepare'], actual: null },
  ]);
  assert.equal(m.samples, 2);
  assert.equal(m.completed, 1);
  assert.equal(m.byClass[0].fn, 1);
  assert.equal(m.macroF1, 2 / 3);
});
test('false positive classes penalize macro F1 even without expected support', () => {
  const m = classification([{ expected: ['none'], actual: ['poll/prepare'] }]);
  assert.equal(m.macroF1, 0);
  assert.equal(m.byClass.find((x) => x.label === 'poll/prepare').fp, 1);
});
test('nearest-rank p95 uses sorted observations rather than averaging averages', () =>
  assert.equal(quantile(Array.from({ length: 20 }, (_, i) => i + 1)), 19));
test('release gate blocks missing physical and semantic evidence despite green program tests', () => {
  assert.equal(
    releaseGate([
      { id: 'unit', status: 'passed' },
      { id: 'model', status: 'blocked' },
    ]).ready,
    false,
  );
  assert.equal(releaseGate([{ id: 'unit', status: 'failed' }]).status, 'failed');
});
test('review cannot apply to a different run or repeat one case in place of another', () => {
  assert.equal(
    reviewStatus({ runHash: 'old', reviewer: 'R', entries: [] }, 'new', []).status,
    'failed',
  );
  assert.equal(
    reviewStatus({ runHash: 'r', reviewer: 'R', entries: [{ id: 'a' }, { id: 'a' }] }, 'r', [
      'a',
      'b',
    ]).status,
    'failed',
  );
  assert.equal(
    reviewStatus(
      { runHash: 'r', reviewer: 'R', entries: [{ id: 'a', verdict: 'pass', evidence: [] }] },
      'r',
      ['a'],
    ).status,
    'review_required',
  );
});
test('negated intents have no action label; clarification and suggested operations remain observable', () => {
  assert.deepEqual(
    intentLabels([
      { family: 'poll', operation: 'publish', expression: 'negated', resolution: 'no_action' },
    ]),
    ['none'],
  );
  assert.deepEqual(
    intentLabels([
      {
        family: 'poll',
        operation: 'prepare',
        expression: 'explicit',
        resolution: 'needs_clarification',
      },
    ]),
    ['poll/prepare'],
  );
});
test('frozen corpus is complete and catches duplicate identities', () => {
  const corpus = JSON.parse(readFileSync(new URL('./events.json', import.meta.url)));
  assert.deepEqual(validateCorpus(corpus), []);
  corpus.cases[1].id = corpus.cases[0].id;
  assert.ok(validateCorpus(corpus).some((e) => e.startsWith('duplicate case')));
});

test('corpus labels match runtime schema and reject a plausible but invalid confirmation alias', async () => {
  const { Family } = await import('../../src/contracts/collaboration.ts');
  const { CollaborationIntent } = await import('../../src/contracts/collaboration-workflow.ts');
  const corpus = JSON.parse(readFileSync(new URL('./events.json', import.meta.url)));
  for (const c of corpus.cases)
    for (const label of c.expected.finalIntentLabels)
      if (label !== 'none') {
        assert.ok(Family.options.includes(label.split('/')[0]));
        assert.ok(CollaborationIntent.shape.operation.options.includes(label.split('/')[1]));
      }
  corpus.cases[0].expected.finalIntentLabels = ['confirmation/prepare'];
  assert.ok(validateCorpus(corpus).some((x) => x.startsWith('unknown intent label')));
});
