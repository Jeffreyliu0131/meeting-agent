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
