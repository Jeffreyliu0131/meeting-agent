import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMeeting, reduceMeeting } from '../../src/domain/commands';
import { defaults, SQLiteStore } from '../../src/service/store';
import {
  applyCollaboration,
  validateCollaboration,
  collaborationCommand,
} from '../../src/domain/intent-preparation';
import {
  CollaborationProposal,
  type IntentCandidate,
  type DraftContent,
} from '../../src/contracts/intent-preparation';
import { SessionService } from '../../src/service/session';
import { readSet, readsValid, resolveNewRefs } from '../../src/service/workflow-state';
import { pendingSegments, contextPayload, buildContextBatch } from '../../src/agent/context';
import type { Meeting, Proposal } from '../../src/contracts/model';
import type { ModelPort } from '../../src/agent/provider';

const config = {
  key: '',
  base: 'https://example.invalid',
  model: 'synthetic',
  sttKey: '',
  sttBase: 'https://example.invalid',
  sttModel: 'synthetic',
  format: 'json_schema',
  minBatchMs: 10000,
};
function setup() {
  const m = createMeeting(
    { title: 'Synthetic', mode: 'manual', outputLocale: 'zh-CN', timezone: 'UTC' },
    defaults,
  );
  collaborationCommand(m, 'collaborationEnable', { enabled: true });
  source(m, '准备投票，A方案与B方案。小王做接口，周五交付。时间有冲突，按B方案执行需审批。');
  return m;
}
function source(m: Meeting, text: string, finality: 'partial' | 'final' = 'final') {
  return reduceMeeting(m, {
    id: crypto.randomUUID(),
    meetingId: m.id,
    type: 'ingest',
    payload: { kind: 'manual', text, finality },
  }).result as Meeting['segments'][number];
}
function candidate(m: Meeting, kind: IntentCandidate['family'] = 'poll'): IntentCandidate {
  const s = m.segments.at(-1)!,
    evidence = [{ id: s.id, rev: s.rev }];
  const contents: Record<IntentCandidate['family'], DraftContent> = {
    poll: {
      kind: 'poll',
      question: '选哪个方案？',
      selection: 'single',
      options: [
        { key: 'a', label: 'A方案', sources: evidence },
        { key: 'b', label: 'B方案', sources: evidence },
      ],
    },
    assignment: {
      kind: 'assignment',
      items: [
        {
          key: 'task',
          task: '接口',
          deliverable: '接口',
          owner: '小王',
          time: '周五',
          dependencies: [],
          sources: evidence,
        },
      ],
    },
    conflict: {
      kind: 'conflict',
      summary: '时间待确认',
      sides: [{ key: 'side', description: '安排', sources: evidence }],
      questions: ['是否需要独占投入？'],
      resolutions: ['先明确工作量'],
    },
    decision_confirmation: {
      kind: 'decision_confirmation',
      statement: '按B方案执行',
      scopeText: '本次试点',
      conditions: ['需审批'],
    },
  };
  return {
    localId: kind,
    family: kind,
    operation: 'prepare',
    expression: 'explicit',
    resolution: 'actionable_draft',
    target: null,
    targetLocalId: null,
    topicRef: null,
    referencedObjects: [],
    evidence,
    collectionMode: 'none',
    scopeText: kind,
    missingSlots: [],
    dependsOnLocalIds: [],
    content: contents[kind],
  };
}
function proposal(intents: IntentCandidate[]): Proposal {
  return {
    objects: [],
    relations: [],
    focus: '',
    changes: [],
    action: 'no_change',
    artifact: null,
    rationale: 'Synthetic test',
    intentPreparation: { intents, coverage: 'complete', unprocessedRefs: [] },
  };
}
function apply(m: Meeting, intents: IntentCandidate[], event = crypto.randomUUID()) {
  const p = proposal(intents);
  validateCollaboration(p, m);
  applyCollaboration(
    m,
    p,
    intents.flatMap((i) => i.evidence),
    event,
  );
}

test('four families produce separate private drafts and never decisions or responses', () => {
  const m = setup();
  apply(
    m,
    ['poll', 'assignment', 'conflict', 'decision_confirmation'].map((k) =>
      candidate(m, k as IntentCandidate['family']),
    ),
  );
  assert.equal(m.intentPreparation!.drafts.length, 4);
  assert.deepEqual(
    m.intentPreparation!.drafts.map((d) => d.content!.kind),
    ['poll', 'assignment', 'conflict', 'decision_confirmation'],
  );
  assert.equal(m.decisions.length, 0);
  assert.ok(m.intentPreparation!.drafts.every((d) => d.status === 'draft'));
});
test('negated, hypothetical and quoted candidates are inert even with actionable resolution', () => {
  for (const expression of ['negated', 'hypothetical', 'quoted'] as const) {
    const m = setup();
    apply(m, [{ ...candidate(m), expression }]);
    assert.equal(m.intentPreparation!.drafts.length, 0);
  }
});
test('suggestions and all side-effect operations cannot execute business actions', () => {
  const m = setup();
  for (const operation of [
    'publish',
    'respond',
    'close',
    'cancel',
    'apply_resolution',
    'record_decision',
  ] as const) {
    apply(m, [{ ...candidate(m), operation }]);
  }
  assert.equal(m.decisions.length, 0);
  assert.ok(
    m.intentPreparation!.drafts.every((d) => ['suggestion', 'needs_clarification'].includes(d.status)),
  );
});
test('ordered multiple intents reject cycles, forward references and wrong family', () => {
  const m = setup(),
    a = candidate(m),
    b = { ...candidate(m, 'assignment'), dependsOnLocalIds: ['poll'] };
  validateCollaboration(proposal([a, b]), m);
  assert.throws(() => validateCollaboration(proposal([b, a]), m), /DEPENDENCY/);
  assert.throws(() => validateCollaboration(proposal([{ ...a, content: b.content }]), m), /FAMILY/);
  assert.equal(
    CollaborationProposal.safeParse({
      intents: [a, a, a, a, a],
      coverage: 'complete',
      unprocessedRefs: [],
    }).success,
    false,
  );
});
test('sources must exist, be current final meeting speech; owners and dates require literal evidence', () => {
  const m = setup(),
    i = candidate(m, 'assignment');
  if (i.content?.kind !== 'assignment') throw new Error('fixture');
  i.content.items[0].owner = '李四';
  assert.throws(() => validateCollaboration(proposal([i]), m), /UNGROUNDED/);
  i.content.items[0].owner = null;
  i.content.items[0].time = null;
  validateCollaboration(proposal([i]), m);
  m.segments[0].kind = 'request';
  assert.throws(() => validateCollaboration(proposal([i]), m), /SOURCE/);
  m.segments[0].kind = 'manual';
  m.segments[0].finality = 'partial';
  assert.throws(() => validateCollaboration(proposal([i]), m), /SOURCE/);
});
test('partial input is readable but excluded from pending work and meeting model projection', () => {
  const m = setup();
  m.processedSources = { [m.segments[0].id]: 1 };
  const partial = source(m, '暂定投票', 'partial');
  assert.equal(pendingSegments(m).length, 0);
  assert.ok(!contextPayload(m).segments.some((s) => s.id === partial.id));
  reduceMeeting(m, {
    id: crypto.randomUUID(),
    meetingId: m.id,
    type: 'correct',
    payload: { segmentId: partial.id, baseRevision: 1, text: '确定投票' },
  });
  assert.equal(pendingSegments(m)[0].rev, 2);
});
test('collector updates same ID, preserves manual fields and tombstones, and ignores unrelated input', () => {
  const m = setup(),
    i = { ...candidate(m), collectionMode: 'prospective' as const };
  apply(m, [i]);
  const d = m.intentPreparation!.drafts[0],
    id = d.id;
  collaborationCommand(m, 'collaborationEdit', {
    draftId: id,
    expectedRevision: d.rev,
    path: 'options.a.label',
    value: '人工方案',
  });
  collaborationCommand(m, 'collaborationEdit', {
    draftId: id,
    expectedRevision: d.rev,
    path: 'options.b',
    value: null,
  });
  source(m, '无关午饭');
  apply(m, []);
  assert.equal(m.intentPreparation!.drafts.length, 1);
  source(m, 'A方案、B方案、C方案');
  const update = { ...candidate(m), target: { id, rev: d.rev }, operation: 'update' as const };
  apply(m, [update]);
  assert.equal(d.id, id);
  assert.equal(d.status, 'collecting');
  assert.equal(d.content?.kind, 'poll');
  if (d.content?.kind === 'poll')
    assert.deepEqual(
      d.content.options.map((o) => o.label),
      ['人工方案'],
    );
  assert.ok(d.suggestedContent);
  assert.ok(d.history.length);
});
test('event replay and duplicate unchanged intent preserve identity and revision', () => {
  const m = setup(),
    i = candidate(m),
    event = crypto.randomUUID();
  apply(m, [i], event);
  const before = structuredClone(m.intentPreparation);
  apply(m, [i], event);
  assert.deepEqual(m.intentPreparation, before);
  apply(m, [i]);
  assert.equal(m.intentPreparation!.drafts.length, 1);
  assert.equal(m.intentPreparation!.drafts[0].rev, 1);
});
test('ambiguous target remains a question; selecting a version does not publish', () => {
  const m = setup();
  apply(m, [candidate(m)]);
  source(m, '另一个投票');
  apply(m, [candidate(m)]);
  source(m, '开始吧');
  apply(m, [{ ...candidate(m), operation: 'publish', resolution: 'needs_clarification' }]);
  const [a, , q] = m.intentPreparation!.drafts;
  assert.equal(q.status, 'needs_clarification');
  collaborationCommand(m, 'collaborationResolve', {
    draftId: q.id,
    expectedRevision: q.rev,
    target: { id: a.id, rev: a.rev },
  });
  assert.equal(q.status, 'suggestion');
  assert.equal(a.status, 'draft');
  assert.equal(m.decisions.length, 0);
});
test('freeze refuses unprocessed sources and freezes preview against later updates', () => {
  const m = setup();
  apply(m, [{ ...candidate(m), collectionMode: 'prospective' }]);
  const d = m.intentPreparation!.drafts[0],
    base = () => ({ draftId: d.id, expectedRevision: d.rev });
  assert.throws(
    () => collaborationCommand(m, 'collaborationFreeze', base()),
    /ANALYSIS_INCOMPLETE/,
  );
  m.processedSources = { [m.segments[0].id]: 1 };
  collaborationCommand(m, 'collaborationFreeze', base());
  const snapshot = structuredClone(d);
  source(m, '后来的新方案');
  apply(m, [{ ...candidate(m), operation: 'update', target: { id: d.id, rev: d.rev } }]);
  assert.deepEqual(d, snapshot);
});
test('draft editing invalidates in-flight reads and rejects stale commands and prototype fields', () => {
  const m = setup();
  apply(m, [candidate(m)]);
  const read = readSet(m),
    d = m.intentPreparation!.drafts[0],
    old = d.rev;
  collaborationCommand(m, 'collaborationEdit', {
    draftId: d.id,
    expectedRevision: old,
    path: 'question',
    value: '新的题目',
  });
  assert.equal(readsValid(read, m), false);
  assert.throws(
    () => collaborationCommand(m, 'collaborationDismiss', { draftId: d.id, expectedRevision: old }),
    /STALE/,
  );
  assert.throws(
    () =>
      collaborationCommand(m, 'collaborationEdit', {
        draftId: d.id,
        expectedRevision: d.rev,
        path: '__proto__.polluted',
        value: true,
      }),
    /INVALID/,
  );
});
test('dismissed suggestion is not revived by replay; personal context has no intentPreparation capability', () => {
  const m = setup(),
    i = candidate(m);
  apply(m, [i]);
  const d = m.intentPreparation!.drafts[0];
  collaborationCommand(m, 'collaborationDismiss', { draftId: d.id, expectedRevision: d.rev });
  apply(m, [i]);
  assert.equal(m.intentPreparation!.drafts.length, 1);
  assert.equal(d.status, 'dismissed');
  m.contextScope = 'personal';
  assert.equal(contextPayload(m).intentPreparation, null);
  assert.throws(() => validateCollaboration(proposal([i]), m), /DISABLED/);
});
test('source corrections flag review and meeting end stops collectors', () => {
  const m = setup();
  apply(m, [{ ...candidate(m), collectionMode: 'prospective' }]);
  reduceMeeting(m, {
    id: crypto.randomUUID(),
    meetingId: m.id,
    type: 'correct',
    payload: { segmentId: m.segments[0].id, baseRevision: 1, text: '先别投票' },
  });
  assert.ok(m.intentPreparation!.drafts[0].needsReview);
  reduceMeeting(m, { id: crypto.randomUUID(), meetingId: m.id, type: 'end', payload: {} });
  assert.equal(m.intentPreparation!.drafts[0].status, 'draft');
});

test('review: suggested updates do not overwrite an existing collector', () => {
  const m = setup();
  apply(m, [{ ...candidate(m), collectionMode: 'prospective' }]);
  const d = m.intentPreparation!.drafts[0],
    before = structuredClone(d);
  source(m, '要不要改成其他方案？');
  const update = {
    ...candidate(m),
    target: { id: d.id, rev: d.rev },
    operation: 'update' as const,
    expression: 'suggested' as const,
  };
  if (update.content?.kind === 'poll') update.content.question = '新的建议';
  apply(m, [update]);
  assert.deepEqual(d, before);
  assert.equal(m.intentPreparation!.drafts[1].status, 'suggestion');
});

test('review: merging protected poll labels cannot introduce duplicate options', () => {
  const m = setup();
  apply(m, [candidate(m)]);
  const d = m.intentPreparation!.drafts[0];
  collaborationCommand(m, 'collaborationEdit', {
    draftId: d.id,
    expectedRevision: d.rev,
    path: 'options.a.label',
    value: 'C方案',
  });
  source(m, '新提到C方案');
  const update = {
    ...candidate(m),
    target: { id: d.id, rev: d.rev },
    operation: 'update' as const,
  };
  if (update.content?.kind === 'poll')
    update.content.options.push({ key: 'c', label: 'C方案', sources: update.evidence });
  validateCollaboration(proposal([update]), m);
  assert.throws(() => apply(m, [update]), /DUPLICATE_OPTIONS/);
  assert.equal((d.content as any).options.length, 2);
});

test('operation suggestions never modify or stop their existing target collector', () => {
  const m = setup();
  apply(m, [{ ...candidate(m), collectionMode: 'prospective' }]);
  const d = m.intentPreparation!.drafts[0],
    before = structuredClone(d);
  for (const operation of [
    'publish',
    'cancel',
    'close',
    'respond',
    'apply_resolution',
    'record_decision',
  ] as const) {
    apply(m, [{ ...candidate(m), target: { id: d.id, rev: d.rev }, operation }]);
    assert.deepEqual(d, before);
  }
  assert.equal(m.intentPreparation!.drafts.length, 7);
});

test('partial coverage persists, and the fifth collector is only a suggestion', () => {
  const m = setup();
  for (let index = 0; index < 5; index++) {
    source(m, `选题${index}`);
    apply(m, [{ ...candidate(m), collectionMode: 'prospective' }]);
  }
  assert.equal(m.intentPreparation!.drafts.filter((d) => d.status === 'collecting').length, 4);
  assert.equal(m.intentPreparation!.drafts.at(-1)!.status, 'suggestion');
  const p = proposal([]);
  p.intentPreparation!.coverage = 'partial';
  p.intentPreparation!.unprocessedRefs = [{ id: m.segments[0].id, rev: 1 }];
  validateCollaboration(p, m);
  applyCollaboration(m, p, [], 'partial');
  assert.equal(m.intentPreparation!.coverage, 'partial');
  assert.equal(m.intentPreparation!.unprocessedRefs.length, 1);
});

test('batch-local draft targets map to stable IDs and suppressed dependencies do not execute', () => {
  const m = setup(),
    a = candidate(m),
    b = {
      ...candidate(m),
      localId: 'second',
      operation: 'preview' as const,
      targetLocalId: a.localId,
      dependsOnLocalIds: [a.localId],
    };
  apply(m, [a, b]);
  assert.equal(m.intentPreparation!.drafts[1].candidate.target!.id, m.intentPreparation!.drafts[0].id);
  const fresh = setup();
  const first = { ...candidate(fresh), expression: 'negated' as const };
  apply(fresh, [first, { ...candidate(fresh, 'assignment'), dependsOnLocalIds: [first.localId] }]);
  assert.equal(fresh.intentPreparation!.drafts.length, 0);
});

test('draft edits are command-idempotent and storage failure cannot publish new memory state', () => {
  const store = new SQLiteStore(
    join(mkdtempSync(join(tmpdir(), 'intent-failure-')), 'state.sqlite'),
  );
  const m = setup();
  apply(m, [candidate(m)]);
  store.save([m], defaults);
  const service = new SessionService(
    store,
    {
      interpret: async () => {
        throw new Error('UNEXPECTED_MODEL_CALL');
      },
    },
    config,
  );
  try {
    const d = service.meetings[0].intentPreparation!.drafts[0];
    const command = {
      id: crypto.randomUUID(),
      meetingId: m.id,
      type: 'collaborationEdit',
      payload: { draftId: d.id, expectedRevision: d.rev, path: 'question', value: 'Host text' },
    };
    const originalSave = store.save.bind(store);
    store.save = () => {
      throw new Error('Injected disk failure');
    };
    assert.throws(() => service.command(command), /STORAGE_FAILED/);
    assert.notEqual(
      (service.meetings[0].intentPreparation!.drafts[0].content as any).question,
      'Host text',
    );
    store.save = originalSave;
    service.command(command);
    const rev = service.meetings[0].intentPreparation!.drafts[0].rev;
    service.command(command);
    assert.equal(service.meetings[0].intentPreparation!.drafts[0].rev, rev);
  } finally {
    service.close();
  }
});
test('proposal temporary object refs map to server IDs', () => {
  const m = setup(),
    i = candidate(m);
  i.referencedObjects = [{ id: 'new_option', rev: 1 }];
  const p = proposal([i]);
  p.objects = [
    {
      id: 'new_option',
      kind: 'option',
      title: 'A',
      detail: '',
      origin: 'stated',
      status: 'unverified',
      lifecycle: 'active',
      sources: i.evidence,
    },
  ];
  const resolved = resolveNewRefs(p, m);
  assert.equal(
    resolved.proposal.intentPreparation!.intents[0].referencedObjects[0].id,
    resolved.idMap.new_option,
  );
  validateCollaboration(resolved.proposal, m);
});
test('service pipeline persists all four drafts atomically and restores without re-inference', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'intent-synthetic-')), 'state.sqlite');
  let calls = 0;
  const model: ModelPort = {
    interpret: async (m) => {
      calls++;
      return {
        proposal: proposal(
          ['poll', 'assignment', 'conflict', 'decision_confirmation'].map((k) =>
            candidate(m, k as IntentCandidate['family']),
          ),
        ),
        inputTokens: 0,
        outputTokens: 0,
      };
    },
  };
  const store = new SQLiteStore(path),
    service = new SessionService(store, model, config);
  const id = service.command({
    id: crypto.randomUUID(),
    meetingId: null,
    type: 'create',
    payload: { title: 'Synthetic', mode: 'manual', outputLocale: 'zh-CN', timezone: 'UTC' },
  }) as string;
  service.command({
    id: crypto.randomUUID(),
    meetingId: id,
    type: 'collaborationEnable',
    payload: { enabled: true },
  });
  service.command({
    id: crypto.randomUUID(),
    meetingId: id,
    type: 'ingest',
    payload: { kind: 'manual', text: '小王做接口，周五交付。投票A或B，时间冲突，需审批。' },
  });
  await service.process(id);
  assert.equal(
    service.meetings[0].intentPreparation!.drafts.length,
    4,
    service.meetings[0].error ?? 'missing drafts',
  );
  const saved = structuredClone(service.meetings[0].intentPreparation);
  service.close();
  const restored = new SessionService(new SQLiteStore(path), model, config);
  try {
    await restored.process(id);
    assert.deepEqual(restored.meetings[0].intentPreparation, saved);
    assert.equal(calls, 1);
  } finally {
    restored.close();
  }
});
