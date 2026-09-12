import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../../src/service/store';
import { SessionService } from '../../src/service/session';
import { emptyContent } from '../../src/contracts/collaboration';
const config = {
  key: '',
  base: 'https://example.invalid',
  model: 'test',
  sttKey: '',
  sttBase: 'https://example.invalid',
  sttModel: 'test',
  format: 'json_schema',
};
const model = {
  interpret: async (): Promise<never> => {
    throw Error('UNEXPECTED_MODEL');
  },
};

test('normal audio meetings prepare collaboration automatically without a host setup step', () => {
  const service = new SessionService(new SQLiteStore(':memory:'), model, config);
  try {
    service.command({
      id: crypto.randomUUID(),
      type: 'create',
      meetingId: null,
      payload: {
        title: 'Automatic components',
        mode: 'microphone',
        outputLocale: 'zh-CN',
        timezone: 'Asia/Shanghai',
      },
    });
    const state = service.meetings[0].collaboration;
    assert.ok(state);
    assert.equal(state.participants.filter((p) => p.role === 'participant').length, 3);
    assert.equal(state.components.length, 0);
    assert.equal(service.meetings[0].capture, 'idle');
  } finally {
    service.close();
  }
});
test('publish retries retain the clicked source frontier instead of following unrelated new speech forever', () => {
  const { service, meetingId } = setup();
  try {
    service.enableCollaboration(meetingId, ['A']);
    const state = service.meetings[0].collaboration!;
    const actor = state.participants[0].id;
    const content = emptyContent('poll');
    if (content.kind !== 'poll') throw Error();
    content.payload.question = 'A或B';
    content.payload.options = ['A', 'B'].map((id) => ({
      id,
      label: id,
      description: '',
      objectRefs: [],
    }));
    service.collaborate(
      { id: crypto.randomUUID(), meetingId, type: 'component.prepare', payload: { content } },
      actor,
    );
    const c = service.meetings[0].collaboration!.components[0];
    service.meetings[0].segments.push({
      id: 'first',
      rev: 1,
      text: '已收到',
      kind: 'manual',
    } as any);
    const command = {
      id: crypto.randomUUID(),
      meetingId,
      type: 'component.publish',
      payload: {
        componentId: c.id,
        draftRevision: c.draftRevision,
        expectedAggregateVersion: c.aggregateVersion,
        audienceIds: [state.participants[1].id],
        sourceDisclosure: [],
      },
    };
    assert.throws(() => service.collaborate(command, actor), /ANALYSIS_INCOMPLETE/);
    assert.equal(service.meetings[0].collaboration!.evaluationFrontiers?.length, 1);
    service.meetings[0].processedSources!.first = 1;
    service.meetings[0].segments.push({
      id: 'later',
      rev: 1,
      text: '新话题',
      kind: 'manual',
    } as any);
    service.collaborate(command, actor);
    assert.equal(service.meetings[0].collaboration!.components[0].rounds.length, 1);
  } finally {
    service.close();
  }
});
function setup() {
  const store = new SQLiteStore(':memory:');
  const service = new SessionService(store, model, config);
  const meetingId = service.command({
    id: crypto.randomUUID(),
    type: 'create',
    meetingId: null,
    payload: {
      title: 'Synthetic collaboration',
      mode: 'manual',
      outputLocale: 'en',
      timezone: 'UTC',
    },
  }) as string;
  return { store, service, meetingId };
}
test('collaboration is restored from normalized storage with old meetings preserved', () => {
  const { store, service, meetingId } = setup();
  service.enableCollaboration(meetingId, ['A', 'B', 'C']);
  const s = service.meetings[0].collaboration!;
  service.collaborate(
    {
      id: crypto.randomUUID(),
      meetingId,
      type: 'component.prepare',
      payload: { content: emptyContent('poll') },
    },
    s.participants[0].id,
  );
  const loaded = store.load();
  assert.equal(loaded.meetings[0].title, 'Synthetic collaboration');
  assert.equal(loaded.meetings[0].collaboration?.components.length, 1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM collaboration_revisions').get()!.n, 1);
  store.close();
});
test('command replay is idempotent and belongs to its original trusted actor', () => {
  const { store, service, meetingId } = setup();
  service.enableCollaboration(meetingId, ['A']);
  const s = service.meetings[0].collaboration!;
  const command = {
    id: crypto.randomUUID(),
    meetingId,
    type: 'component.prepare',
    payload: { content: emptyContent('poll') },
  };
  const result = service.collaborate(command, s.participants[0].id);
  assert.equal(service.collaborate(command, s.participants[0].id), result);
  assert.equal(service.meetings[0].collaboration!.components.length, 1);
  assert.throws(
    () => service.collaborate(command, s.participants[1].id),
    /UNAUTHORIZED|IDEMPOTENCY/,
  );
  store.close();
});
test('failed collaboration storage does not publish changed memory or save partial records', () => {
  const { store, service, meetingId } = setup();
  service.enableCollaboration(meetingId, ['A']);
  const s = service.meetings[0].collaboration!;
  store.db.exec(
    "CREATE TRIGGER reject_component BEFORE INSERT ON collaboration_components BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  assert.throws(
    () =>
      service.collaborate(
        {
          id: crypto.randomUUID(),
          meetingId,
          type: 'component.prepare',
          payload: { content: emptyContent('poll') },
        },
        s.participants[0].id,
      ),
    /STORAGE_FAILED/,
  );
  assert.equal(service.meetings[0].collaboration!.components.length, 0);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM collaboration_revisions').get()!.n, 0);
  store.close();
});

test('meeting understanding schedules the real component graph and persists its draft', async () => {
  const store = new SQLiteStore(':memory:');
  const connected = {
    interpret: async (meeting: any) => ({
      proposal: {
        focus: '准备投票',
        changes: [],
        objects: [],
        relations: [],
        action: 'no_change',
        artifact: null,
        rationale: '',
        collaborationIntents: [
          {
            family: 'poll',
            operation: 'prepare',
            expression: 'explicit',
            resolution: 'actionable_draft',
            targetId: null,
            scopeText: '试点',
            collectionMode: 'prospective',
            sourceRefs: meeting.segments.map((s: any) => ({ id: s.id, rev: s.rev })),
            objectRefs: [],
          },
        ],
      },
      inputTokens: 10,
      outputTokens: 10,
    }),
    prepareComponent: async () => ({
      content: {
        kind: 'poll',
        payload: {
          question: '先选哪个？',
          contextSummary: '',
          options: [
            { id: 'a', label: '内部', description: '', objectRefs: [] },
            { id: 'b', label: '客户', description: '', objectRefs: [] },
          ],
          selection: { mode: 'single', min: 1, max: 1 },
          allowAbstain: true,
          resultsVisibility: 'after_close',
          closePolicy: { kind: 'host' },
        },
      },
      clarification: null,
    }),
  };
  const service = new SessionService(store, connected as any, {
    ...config,
    key: 'synthetic',
    minBatchMs: 5,
  });
  try {
    const meetingId = service.command({
      id: crypto.randomUUID(),
      type: 'create',
      meetingId: null,
      payload: { title: 'Graph pipeline', mode: 'manual', outputLocale: 'zh-CN', timezone: 'UTC' },
    }) as string;
    service.enableCollaboration(meetingId, ['A']);
    service.command({
      id: crypto.randomUUID(),
      type: 'ingest',
      meetingId,
      payload: { text: '准备投票：内部试点还是邀请客户。', kind: 'manual' },
    });
    for (let i = 0; i < 60 && !service.meetings[0].collaboration!.components.length; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(service.meetings[0].collaboration!.components.length, 1);
    assert.equal(service.meetings[0].collaboration!.components[0].rounds.length, 0);
    assert.equal(service.meetings[0].collaboration!.jobs[0].status, 'succeeded');
  } finally {
    service.close();
  }
});

async function confirmation() {
  const x = setup();
  const command = (type: string, payload: any, actorId: string) =>
    x.service.collaborate(
      { id: crypto.randomUUID(), meetingId: x.meetingId, type, payload },
      actorId,
    );
  x.service.enableCollaboration(x.meetingId, ['A']);
  const participants = x.service.meetings[0].collaboration!.participants;
  const host = participants[0].id,
    person = participants[1].id;
  const content = emptyContent('decision_confirmation');
  if (content.kind !== 'decision_confirmation') throw Error();
  content.payload.statement = 'Proceed with internal pilot';
  content.payload.scopeText = 'Participant A';
  const cid = command('component.prepare', { content }, host);
  await x.service.flush();
  const component = () =>
    x.service.meetings[0].collaboration!.components.find((c) => c.id === cid)!;
  const publish = async () => {
    let c = component();
    command(
      'component.publish',
      {
        componentId: cid,
        draftRevision: c.draftRevision,
        expectedAggregateVersion: c.aggregateVersion,
        audienceIds: [person],
        sourceDisclosure: [],
      },
      host,
    );
    await x.service.flush();
  };
  const respond = async (response: any, expectedResponseVersion: number) => {
    command(
      'component.respond',
      {
        componentId: cid,
        publishedRevision: component().publishedRevision,
        expectedResponseVersion,
        response,
      },
      person,
    );
    await x.service.flush();
  };
  const record = () => {
    const c = component();
    return command(
      'component.record_decision',
      {
        componentId: cid,
        publishedRevision: c.publishedRevision,
        expectedAggregateVersion: c.aggregateVersion,
      },
      host,
    );
  };
  await publish();
  return { ...x, command, host, person, cid, component, publish, respond, record };
}
test('explicit agreement to revised confirmation should clear the old objection', async () => {
  const x = await confirmation();
  try {
    await x.respond({ kind: 'disagree', reason: 'Pilot needs to be limited' }, 0);
    const state = x.service.meetings[0].collaboration!;
    const reported = state.conflicts[0];
    state.conflicts.push({
      ...structuredClone(reported),
      id: 'semantic-objection',
      fingerprint: 'semantic-objection',
      basis: 'agent_inferred',
      verification: 'needs_confirmation',
    });
    const revised = structuredClone(x.component().revisions.at(-1)!.content);
    if (revised.kind !== 'decision_confirmation') throw Error();
    revised.payload.statement = 'Proceed with limited internal pilot';
    x.command(
      'component.edit_draft',
      { componentId: x.cid, baseDraftRevision: x.component().draftRevision, content: revised },
      x.host,
    );
    await x.service.flush();
    await x.publish();
    await x.respond({ kind: 'agree' }, 0);
    assert.doesNotThrow(() => x.record());
  } finally {
    x.service.close();
  }
});
test('recording a decision must not silently ignore a known input gap', async () => {
  const x = await confirmation();
  try {
    await x.respond({ kind: 'agree' }, 0);
    x.service.recordInputGap(
      {
        meetingId: x.meetingId,
        epoch: x.service.meetings[0].epoch,
        channel: 'microphone',
        segmentId: 'missing-final',
        receivedAt: new Date().toISOString(),
        captureStartMs: 0,
        captureEndMs: 1000,
        channelSequence: 0,
      },
      'TRANSCRIPTION_FAILED',
    );
    assert.throws(() => x.record(), /INPUT_GAP_UNRESOLVED/);
    assert.equal(x.service.meetings[0].collaboration!.decisions.length, 0);
  } finally {
    x.service.close();
  }
});
