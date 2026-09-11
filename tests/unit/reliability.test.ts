import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMeeting, reduceMeeting, uid } from '../../src/domain/commands';
import { buildContextBatch, contextPayload } from '../../src/agent/context';
import { defaults, SQLiteStore } from '../../src/service/store';
import { SessionService } from '../../src/service/session';
import { validateDelta } from '../../src/renderers/validate';
import { commitMeaning, refreshIntegrity } from '../../src/domain/meaning';
import { reconcileCloseout } from '../../src/domain/closeout';
import { artifactIsStale } from '../../src/domain/artifacts';
import type { Meeting, Proposal, ObjectState, ArtifactRevision } from '../../src/contracts/model';
import type { ModelPort } from '../../src/agent/provider';

const config = {
  key: '',
  base: 'https://example.invalid',
  model: 'test',
  sttKey: '',
  sttBase: 'https://example.invalid',
  sttModel: 'test',
  format: 'json_schema',
  minBatchMs: 1,
};
function meeting() {
  return createMeeting(
    {
      title: 'Synthetic reliability test',
      mode: 'manual',
      outputLocale: 'zh-CN',
      timezone: 'Asia/Singapore',
    },
    defaults,
  );
}
function source(m: Meeting, id: string, text: string, kind: 'manual' | 'request' = 'manual') {
  reduceMeeting(m, {
    id: uid(),
    meetingId: m.id,
    type: kind === 'request' ? 'ask' : 'ingest',
    payload: { segmentId: id, text, kind },
  });
  return { id, rev: 1 };
}
const empty = (): Proposal => ({
  focus: '',
  changes: [],
  objects: [],
  relations: [],
  action: 'no_change',
  artifact: null,
  rationale: 'Synthetic test double',
});
function object(
  id: string,
  text: string,
  sourceId: string,
  kind: ObjectState['kind'] = 'claim',
): Proposal['objects'][number] {
  return {
    id,
    kind,
    title: text,
    detail: text,
    origin: 'stated',
    status: 'unverified',
    sources: [{ id: sourceId, rev: 1 }],
    lifecycle: 'active',
  };
}
function seed() {
  const m = meeting();
  source(m, 's1', '预算批准后周五上线');
  const p = empty();
  p.objects = [
    object('budget', '预算批准', 's1', 'constraint'),
    {
      ...object('launch', '周五上线', 's1', 'task'),
      meaning: {
        stance: 'conditional',
        conditionIds: ['budget'],
        owner: null,
        deadline: {
          value: '周五',
          evidence: { quote: '预算批准后周五上线', sources: [{ id: 's1', rev: 1 }] },
        },
        evidence: [{ quote: '预算批准后周五上线', sources: [{ id: 's1', rev: 1 }] }],
      },
      changeSources: [],
    },
  ];
  validateDelta(p, m);
  commitMeaning(m, p);
  m.processedSources = { s1: 1 };
  return m;
}
function artifact(m: Meeting): ArtifactRevision {
  return {
    id: 'a',
    rev: 1,
    generation: 1,
    inputVersion: m.inputVersion,
    languageRevision: 1,
    locale: 'zh-CN',
    purposeKey: 'launch',
    question: '上线安排',
    summary: '计划',
    layout: 'stack',
    objectIds: ['launch'],
    sources: [{ id: 's1', rev: 1 }],
    formulas: [],
    blocks: [
      {
        id: 'body',
        type: 'text',
        title: '计划',
        items: ['周五'],
        origin: 'stated',
        status: 'unverified',
        objectIds: ['launch'],
        sources: [{ id: 's1', rev: 1 }],
      },
    ],
    objectRefs: [{ id: 'launch', rev: m.objects.find((o) => o.id === 'launch')!.rev }],
    createdAt: new Date().toISOString(),
    scope: 'meeting',
  };
}
function service(model: ModelPort) {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-reliability-'));
  const path = join(dir, 'test.sqlite');
  const s = new SessionService(new SQLiteStore(path), model, config);
  const id = s.command({
    id: uid(),
    meetingId: null,
    type: 'create',
    payload: { title: 'Synthetic test', mode: 'manual', outputLocale: 'en', timezone: 'UTC' },
  }) as string;
  return {
    s,
    id,
    path,
    command: (type: 'ingest' | 'ask' | 'end' | 'correct' | 'retry', payload = {}) =>
      s.command({ id: uid(), meetingId: id, type, payload }),
    close: () => {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('background understanding excludes personal requests, artifacts, choices and trial values', () => {
  const m = seed();
  const a = artifact(m);
  a.scope = 'personal';
  a.summary = 'PRIVATE_MARKER';
  m.artifacts.push(a);
  source(m, 'private', 'PRIVATE_MARKER', 'request');
  m.processedSources!.private = 1;
  m.decisions.push({
    id: 'd',
    scope: 'personal',
    artifact: a,
    basis: 'PRIVATE_MARKER',
    participants: '',
    sources: [],
    createdAt: '',
  });
  m.scenarios.push({
    id: 'trial',
    artifactId: 'a',
    artifactRev: 1,
    values: { PRIVATE_MARKER: 999 },
    result: '999',
    baseInputVersion: 1,
    createdAt: '',
    formula: {
      id: 'f',
      label: 'PRIVATE_MARKER',
      unit: 'USD',
      parameters: [],
      steps: [],
      result: 'x',
      sources: [],
      basis: '',
    },
  });
  source(m, 'public', '继续讨论');
  const batch = buildContextBatch(m);
  assert.equal(batch.meeting.contextScope, 'meeting');
  assert.equal(JSON.stringify(contextPayload(batch.meeting)).includes('PRIVATE_MARKER'), false);
  assert.equal(m.scenarios.length, 1);
});

test('personal exploration retains an explicitly bound context without rewriting meeting state', () => {
  const m = seed();
  const a = artifact(m);
  a.scope = 'personal';
  m.artifacts.push(a);
  source(m, 'private', '试算一下', 'request');
  m.segments.at(-1)!.requestContext = { artifactId: 'a', artifactRev: 1 };
  const batch = buildContextBatch(m);
  assert.equal(batch.meeting.contextScope, 'personal');
  assert.equal(contextPayload(batch.meeting).currentArtifact?.id, 'a');
  assert.equal(batch.accepted[0].id, 'private');
});

test('conditional statements require conditions; owners and times require actual quoted words', () => {
  const m = seed();
  source(m, 's2', '继续讨论');
  const p = empty();
  p.objects = [
    {
      ...object('new', '安排', 's2'),
      meaning: {
        stance: 'conditional',
        conditionIds: [],
        owner: null,
        deadline: null,
        evidence: [{ quote: '继续讨论', sources: [{ id: 's2', rev: 1 }] }],
      },
    },
  ];
  assert.throws(() => validateDelta(p, m), /CONDITION_REQUIRED/);
  p.objects[0].meaning!.conditionIds = ['budget'];
  p.objects[0].meaning!.owner = {
    value: '张三',
    evidence: { quote: '继续讨论', sources: [{ id: 's2', rev: 1 }] },
  };
  assert.throws(() => validateDelta(p, m), /VALUE_NOT_IN_QUOTE/);
  p.objects[0].meaning!.owner!.evidence.quote = '张三承诺完成';
  assert.throws(() => validateDelta(p, m), /QUOTE_NOT_IN_SOURCE/);
});

test('existing conditions cannot be removed with old evidence or omission', () => {
  const m = seed(),
    p = empty();
  const { rev, dependencyRefs, reviewRequired, ...o } = m.objects.find((o) => o.id === 'launch')!;
  p.objects = [
    {
      ...o,
      meaning: { ...o.meaning!, stance: 'committed', conditionIds: [] },
      changeSources: [{ id: 's1', rev: 1 }],
    },
  ];
  assert.throws(() => validateDelta(p, m), /MEANING_CHANGE_REQUIRES_NEW_EVIDENCE/);
  p.objects[0].meaning = undefined;
  p.objects[0].changeSources = [];
  assert.throws(() => validateDelta(p, m), /MISSING_SOURCE/);
});

test('explicit new speech can revise meaning, preserving prior conditions in history', () => {
  const m = seed();
  source(m, 's2', '周五改为内部测试，预算条件仍保留');
  const p = empty();
  p.objects = [
    {
      ...object('launch', '内部测试', 's2', 'task'),
      meaning: {
        ...m.objects[1].meaning!,
        evidence: [{ quote: '周五改为内部测试，预算条件仍保留', sources: [{ id: 's2', rev: 1 }] }],
      },
      changeSources: [{ id: 's2', rev: 1 }],
    },
  ];
  validateDelta(p, m);
  commitMeaning(m, p);
  assert.equal(m.objects[1].title, '内部测试');
  assert.deepEqual(m.objects[1].meaning!.conditionIds, ['budget']);
  assert.equal(m.objectHistory?.at(-1)?.title, '周五上线');
});

test('active old conditions survive unrelated discussion and missing lexical overlap', () => {
  const m = seed();
  for (let i = 0; i < 100; i++) {
    const id = 'n' + i;
    source(m, id, '新话题 ' + i);
    m.processedSources![id] = 1;
  }
  source(m, 'last', '还是按最早那个限制来');
  const batch = buildContextBatch(m, 24000);
  assert.ok(batch.meeting.objects.some((o) => o.id === 'budget'));
  assert.ok(batch.meeting.objects.some((o) => o.id === 'launch'));
  assert.ok(batch.meeting.segments.some((s) => s.id === 's1'));
});

test('memory overflow is explicit instead of silently dropping active obligations', () => {
  const m = seed();
  for (let i = 0; i < 80; i++) {
    const id = 'n' + i;
    source(m, id, '约束'.repeat(150));
    m.processedSources![id] = 1;
    m.objects.push({ ...object('c' + i, '约束'.repeat(150), id, 'constraint'), rev: 1 });
  }
  source(m, 'last', '继续');
  assert.throws(() => buildContextBatch(m, 8000), /CONTEXT_MEMORY_LIMIT/);
});

test('correcting a source marks dependent tasks and working views stale transitively', () => {
  const m = seed(),
    a = artifact(m);
  const p = empty();
  p.objects = [object('prep', '准备发布', 's1', 'task')];
  p.relations = [
    {
      id: 'dep',
      from: 'prep',
      to: 'launch',
      kind: 'depends_on',
      sources: [{ id: 's1', rev: 1 }],
      origin: 'stated',
    },
  ];
  commitMeaning(m, p);
  reduceMeeting(m, {
    id: uid(),
    meetingId: m.id,
    type: 'correct',
    payload: { segmentId: 's1', baseRevision: 1, text: '预算仍未批准' },
  });
  refreshIntegrity(m);
  assert.ok(m.objects.every((o) => o.reviewRequired));
  assert.equal(artifactIsStale(a, m), true);
  const revisions = m.objects.map((o) => o.rev);
  refreshIntegrity(m);
  assert.deepEqual(
    m.objects.map((o) => o.rev),
    revisions,
  );
});

test('dependency update requires rechecking dependents even when their own source is unchanged', () => {
  const m = seed();
  source(m, 's2', '预算批准改为必须董事会批准');
  const p = empty();
  p.objects = [object('budget', '董事会批准', 's2', 'constraint')];
  commitMeaning(m, p);
  assert.equal(m.objects.find((o) => o.id === 'budget')!.reviewRequired, false);
  assert.equal(m.objects.find((o) => o.id === 'launch')!.reviewRequired, true);
  assert.equal(m.objects.find((o) => o.id === 'launch')!.title, '周五上线');
});

test('meeting decision cannot cite personal requests, including mixed evidence', () => {
  const m = seed();
  m.artifacts.push(artifact(m));
  source(m, 'private', '我个人觉得同意', 'request');
  m.artifacts[0].inputVersion = m.inputVersion;
  assert.throws(
    () =>
      reduceMeeting(m, {
        id: uid(),
        meetingId: m.id,
        type: 'decision',
        payload: {
          artifactId: 'a',
          artifactRev: 1,
          scope: 'meeting',
          basis: 'test',
          participants: 'test',
          sourceIds: ['s1', 'private'],
        },
      }),
    /PERSONAL_SOURCE_IN_MEETING/,
  );
});

test('whole-meeting closeout retains conditions, unresolved questions, missing commitments and gaps', () => {
  const m = seed();
  m.status = 'ended';
  m.objects.push({ ...object('q', '客户何时发布？', 's1', 'question'), rev: 1 });
  m.inputGaps.push({ epoch: 1, channel: 'microphone', receivedAt: '', code: 'STT_FAILED' });
  const report = reconcileCloseout(m)!;
  assert.equal(report.state, 'needs_review');
  assert.deepEqual(report.conditionalObjectIds, ['launch']);
  assert.deepEqual(report.incompleteTaskIds, ['launch']);
  assert.ok(report.unresolvedObjectIds.includes('q'));
  assert.equal(report.gapCount, 1);
});

test('end waits for interpretation and late accepted audio; report persists across restart', async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const x = service({
    interpret: async () => {
      await held;
      return { proposal: empty(), inputTokens: 1, outputTokens: 1 };
    },
  });
  try {
    x.command('ingest', { text: 'Synthetic ending', kind: 'manual', segmentId: 's1' });
    const run = x.s.process(x.id);
    x.s.audioQueueChanged(1, x.id);
    x.command('end');
    assert.equal(x.s.meetings[0].closeout?.state, 'pending');
    release();
    await run;
    assert.equal(x.s.meetings[0].closeout?.state, 'pending');
    x.s.completeAudio(
      {
        meetingId: x.id,
        epoch: 0,
        channel: 'microphone',
        segmentId: 'tail',
        receivedAt: new Date().toISOString(),
        captureStartMs: 0,
        captureEndMs: 5000,
        channelSequence: 1,
      },
      'Synthetic tail',
    );
    x.s.audioQueueChanged(0, x.id);
    await x.s.flush();
    assert.equal(x.s.meetings[0].closeout?.pendingSources.length, 0);
    assert.equal(x.s.meetings[0].closeout?.inputVersion, 2);
    x.s.close();
    const reopened = new SessionService(
      new SQLiteStore(x.path),
      {
        interpret: async () => {
          throw new Error('UNEXPECTED_CALL');
        },
      },
      config,
    );
    assert.equal(reopened.meetings[0].closeout?.inputVersion, 2);
    assert.equal(reopened.meetings[0].capture, 'stopped');
    reopened.close();
  } finally {
    x.close();
  }
});

test('provider failure leaves an incomplete closeout and retry can finish it', async () => {
  let fail = true;
  const x = service({
    interpret: async () => {
      if (fail) throw new Error('MODEL_UNAVAILABLE');
      return { proposal: empty(), inputTokens: 0, outputTokens: 0 };
    },
  });
  try {
    x.command('ingest', { text: 'Synthetic source', kind: 'manual' });
    x.command('end');
    await x.s.flush();
    assert.equal(x.s.meetings[0].closeout?.state, 'needs_review');
    assert.equal(x.s.meetings[0].closeout?.pendingSources.length, 1);
    fail = false;
    x.command('retry');
    await x.s.flush();
    assert.equal(x.s.meetings[0].closeout?.state, 'ready');
  } finally {
    x.close();
  }
});

test('unchanged structured meaning does not churn revisions or invalidate dependents', () => {
  const m = seed();
  const before = m.objects.map((o) => o.rev);
  const p = empty();
  p.objects = m.objects.map(({ rev, dependencyRefs, reviewRequired, ...o }) => o);
  commitMeaning(m, p);
  assert.deepEqual(
    m.objects.map((o) => o.rev),
    before,
  );
  assert.ok(m.objects.every((o) => !o.reviewRequired));
  assert.equal(m.objectHistory!.length, 0);
});

test('stale conclusions cannot clear review by merely repeating their old source', () => {
  const m = seed();
  source(m, 's2', '预算条件有变化');
  const delta = empty();
  delta.objects = [object('budget', '董事会批准', 's2', 'constraint')];
  commitMeaning(m, delta);
  m.processedSources!.s2 = 1;
  const p = empty();
  const { rev, dependencyRefs, reviewRequired, ...o } = m.objects.find((o) => o.id === 'launch')!;
  p.objects = [o];
  assert.throws(() => validateDelta(p, m), /MISSING_SOURCE/);
});

test('old recorded decisions retain their original evidence in background context', () => {
  const m = seed();
  for (let i = 0; i < 5; i++) {
    const id = 'decision-source-' + i;
    source(m, id, 'Decision ' + i);
    m.processedSources![id] = 1;
    m.decisions.push({
      id: 'd' + i,
      scope: 'meeting',
      artifact: artifact(m),
      basis: 'Decision ' + i,
      participants: 'Synthetic test participant',
      sources: [{ id, rev: 1 }],
      createdAt: '',
    });
  }
  source(m, 'new', '换一个话题');
  const context = contextPayload(buildContextBatch(m).meeting);
  assert.equal(context.decisions.length, 5);
  assert.ok(context.segments.some((s) => s.id === 'decision-source-0'));
});

test('late audio counts stay with the ended event while another meeting is active', () => {
  const x = service({
    interpret: async () => ({ proposal: empty(), inputTokens: 0, outputTokens: 0 }),
  });
  try {
    x.s.audioQueueChanged(1, x.id);
    x.command('end');
    const other = x.s.command({
      id: uid(),
      meetingId: null,
      type: 'create',
      payload: {
        title: 'Second synthetic event',
        mode: 'manual',
        outputLocale: 'en',
        timezone: 'UTC',
      },
    });
    x.s.audioQueueChanged(0, x.id);
    assert.equal(x.s.meetings.find((m) => m.id === x.id)!.audioPending, 0);
    assert.equal(x.s.meetings.find((m) => m.id === other)!.audioPending, undefined);
    assert.equal(x.s.meetings.find((m) => m.id === x.id)!.closeout?.state, 'ready');
  } finally {
    x.close();
  }
});

test('restored legacy relations propagate review even when the model is unavailable', () => {
  const m = meeting();
  source(m, 'constraint-source', 'Approval required');
  source(m, 'task-source', 'Prepare release');
  m.processedSources = { 'constraint-source': 1, 'task-source': 1 };
  m.objects = [
    { ...object('c', 'Approval', 'constraint-source', 'constraint'), rev: 1 },
    { ...object('t', 'Release', 'task-source', 'task'), rev: 1 },
  ];
  m.relations = [
    {
      id: 'condition',
      from: 'c',
      to: 't',
      kind: 'conditions',
      origin: 'stated',
      sources: [{ id: 'constraint-source', rev: 1 }],
      rev: 1,
    },
  ];
  const s = new SessionService(
    {
      load: () => ({ meetings: [m], preferences: defaults }),
      save: () => {},
      command: () => null,
      close: () => {},
    },
    {
      interpret: async () => {
        throw new Error('MODEL_UNAVAILABLE');
      },
    },
    config,
  );
  try {
    s.command({
      id: uid(),
      meetingId: m.id,
      type: 'correct',
      payload: { segmentId: 'constraint-source', baseRevision: 1, text: 'Board approval required' },
    });
    assert.ok(s.meetings[0].objects.every((o) => o.reviewRequired));
  } finally {
    s.close();
  }
});
