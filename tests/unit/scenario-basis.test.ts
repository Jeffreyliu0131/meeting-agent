import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scenarioFixture } from '../fixtures/scenario-basis';
import { scenarioBasisStatus } from '../../src/domain/scenario-basis';
import { reduceMeeting, uid } from '../../src/domain/commands';
import { SQLiteStore, defaults } from '../../src/service/store';
import type { Meeting } from '../../src/contracts/model';

const status = (m: Meeting) => scenarioBasisStatus(m.scenarios[0], m);
function correct(m: Meeting, id: string) {
  reduceMeeting(m, {
    id: uid(),
    meetingId: m.id,
    type: 'correct',
    payload: { segmentId: id, baseRevision: 1, text: 'Synthetic correction', speaker: null },
  });
}
test('saved scenario ignores unrelated input, unrelated artifacts and presentation-only revisions', () => {
  const m = scenarioFixture(),
    saved = JSON.stringify(m.scenarios);
  reduceMeeting(m, {
    id: uid(),
    meetingId: m.id,
    type: 'ingest',
    payload: { segmentId: 'unrelated', text: 'Synthetic: next meeting is Friday.', kind: 'manual' },
  });
  m.artifacts.push({ ...structuredClone(m.artifacts[0]), id: 'other', rev: 9, formulas: [] });
  const next = structuredClone(m.artifacts[0]);
  next.rev++;
  next.summary = 'Reworded summary';
  next.layout = 'columns';
  next.formulas[0].label = 'Translated label';
  next.formulas[0].parameters.reverse();
  next.formulas[0].parameters[0].label = 'Translated parameter';
  next.languageRevision = ++m.languageRevision;
  m.artifacts.push(next);
  assert.equal(status(m), 'unchanged');
  assert.equal(JSON.stringify(m.scenarios), saved);
  assert.equal(m.scenarios[0].result, '630');
});
test('a corrected formula source changes the basis before another model response', () => {
  const m = scenarioFixture();
  correct(m, 'cost-source');
  assert.equal(status(m), 'changed');
  assert.equal(m.scenarios[0].formula.sources[0].rev, 1);
  assert.equal(m.scenarios[0].result, '630');
});
test('a corrected transitive condition source changes the basis immediately', () => {
  const m = scenarioFixture();
  correct(m, 'condition-source');
  assert.equal(m.objects[0].rev, 1);
  assert.equal(status(m), 'changed');
});
test('changed object, relation and withdrawn condition invalidate their saved dependency', () => {
  for (const mutate of [
    (m: Meeting) => m.objects[0].rev++,
    (m: Meeting) => m.relations[0].rev++,
    (m: Meeting) => {
      m.objects[1].lifecycle = 'superseded';
    },
    (m: Meeting) => {
      m.objects[1].reviewRequired = true;
    },
  ]) {
    const m = scenarioFixture();
    mutate(m);
    assert.equal(status(m), 'changed');
  }
});
test('a later formula change or removal is detected without changing saved results', () => {
  for (const remove of [false, true]) {
    const m = scenarioFixture(),
      next = structuredClone(m.artifacts[0]);
    next.rev++;
    if (remove) next.formulas = [];
    else next.formulas[0].parameters[0].value = 200;
    m.artifacts.push(next);
    assert.equal(status(m), 'changed');
    assert.equal(m.scenarios[0].result, '630');
    assert.equal(m.scenarios[0].formula.parameters[0].value, 150);
  }
});
test('missing historical artifacts, sources, objects and relations are unknown, not unchanged', () => {
  for (const mutate of [
    (m: Meeting) => {
      m.artifacts = [];
    },
    (m: Meeting) => {
      m.segments = [];
    },
    (m: Meeting) => {
      m.objects = [];
    },
    (m: Meeting) => {
      m.relations = [];
    },
    (m: Meeting) => {
      m.scenarios[0].formula.sources = [];
    },
  ]) {
    const m = scenarioFixture();
    mutate(m);
    assert.equal(status(m), 'unknown');
  }
});
test('known change takes precedence over a different missing dependency', () => {
  const m = scenarioFixture();
  m.relations = [];
  correct(m, 'cost-source');
  assert.equal(status(m), 'changed');
});
test('legacy records without relationRefs and dependency cycles remain readable', () => {
  const m = scenarioFixture();
  delete m.artifacts[0].relationRefs;
  m.objects[1].dependencyRefs = [{ id: 'cost-object', rev: 1 }];
  assert.equal(status(m), 'unchanged');
  correct(m, 'condition-source');
  assert.equal(status(m), 'changed');
});
test('saved basis and results survive SQLite reopen without a schema migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-basis-'));
  let store = new SQLiteStore(join(dir, 'state.sqlite'));
  try {
    const m = scenarioFixture();
    m.inputVersion += 3;
    store.save([m], defaults);
    store.close();
    store = new SQLiteStore(join(dir, 'state.sqlite'));
    const restored = store.load().meetings[0];
    assert.equal(status(restored), 'unchanged');
    correct(restored, 'cost-source');
    store.save([restored], defaults);
    store.close();
    store = new SQLiteStore(join(dir, 'state.sqlite'));
    assert.equal(status(store.load().meetings[0]), 'changed');
    assert.deepEqual(store.load().meetings[0].scenarios, m.scenarios);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
