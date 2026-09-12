import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CollaborationRuntime,
  enqueueCollaborationIntents,
} from '../../src/service/collaboration-runtime';
import { createMeeting } from '../../src/domain/commands';
import { defaults } from '../../src/service/store';
import { createCollaboration, applyCollaborationCommand } from '../../src/domain/collaboration';

const payload = {
  kind: 'poll',
  payload: {
    question: '选择方案',
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
};
function setup() {
  let meeting = createMeeting(
    { title: 'Synthetic', mode: 'manual', outputLocale: 'zh-CN', timezone: 'UTC' },
    defaults,
  );
  meeting.collaboration = createCollaboration(meeting.id, ['A', 'B', 'C']);
  const ports = {
    read: () => meeting,
    save: (next: typeof meeting) => {
      meeting = next;
    },
    generate: async () => ({ content: payload, clarification: null }),
    analyze: async () => ({ conflicts: [] }),
  };
  return {
    ports,
    get meeting() {
      return meeting;
    },
  };
}
test('intent runtime preserves a prospective collector across batches and never publishes from speech', async () => {
  const x = setup();
  const intent = {
    family: 'poll',
    operation: 'prepare',
    expression: 'explicit',
    resolution: 'actionable_draft',
    targetId: null,
    scopeText: '上线方案',
    collectionMode: 'prospective',
    sourceRefs: [],
    objectRefs: [],
  } as any;
  enqueueCollaborationIntents(x.meeting, [intent], [], 'root1');
  await new CollaborationRuntime(x.ports).drain();
  const c = x.meeting.collaboration!.components[0];
  assert.equal(c.draftState, 'collecting');
  assert.equal(c.rounds.length, 0);
  enqueueCollaborationIntents(
    x.meeting,
    [{ ...intent, operation: 'update', targetId: c.id }],
    [],
    'root2',
  );
  await new CollaborationRuntime(x.ports).drain();
  assert.equal(x.meeting.collaboration!.components.length, 1);
  assert.equal(x.meeting.collaboration!.components[0].id, c.id);
  enqueueCollaborationIntents(
    x.meeting,
    [{ ...intent, operation: 'update', targetId: c.id, collectionMode: 'retrospective' }],
    [],
    'root3',
  );
  await new CollaborationRuntime(x.ports).drain();
  const reviewed = x.meeting.collaboration!.components[0];
  assert.equal(reviewed.draftState, 'ready');
  assert.equal(reviewed.collection!.status, 'stopped');
  assert.equal(reviewed.rounds.length, 0);
});
test('negated and quoted intents create no jobs or components', () => {
  const x = setup();
  for (const expression of ['negated', 'hypothetical', 'quoted'])
    enqueueCollaborationIntents(
      x.meeting,
      [
        {
          family: 'poll',
          operation: 'publish',
          expression,
          resolution: 'actionable_draft',
          targetId: null,
          scopeText: '',
          collectionMode: 'none',
          sourceRefs: [],
          objectRefs: [],
        } as any,
      ],
      [],
      expression,
    );
  assert.equal(x.meeting.collaboration!.jobs.length, 0);
});

test('C receives earlier discussion and defaults; voice start freezes a collector for review without publishing', async () => {
  const x = setup();
  x.meeting.segments = [
    { id: 'earlier', rev: 1, kind: 'manual', text: '方案一内部，方案二客户，方案三先内部再客户' },
    { id: 'request', rev: 1, kind: 'manual', text: '这三个方向大家各选一个，今天定下来' },
    { id: 'private', rev: 1, kind: 'request', text: 'PRIVATE_DO_NOT_SHARE' },
  ].map((s, order) => ({ ...s, order, channel: 'manual', receivedAt: x.meeting.createdAt })) as any;
  let context: any;
  const intent = {
    family: 'poll',
    operation: 'prepare',
    expression: 'explicit',
    resolution: 'actionable_draft',
    targetId: null,
    scopeText: '范围',
    collectionMode: 'prospective',
    sourceRefs: [{ id: 'request', rev: 1 }],
    objectRefs: [],
  } as any;
  enqueueCollaborationIntents(x.meeting, [intent], intent.sourceRefs, 'prepare');
  await new CollaborationRuntime({
    ...x.ports,
    generate: async (input) => {
      context = input;
      return { content: payload, clarification: null };
    },
  }).drain();
  assert.ok(context.sources.some((s: any) => s.id === 'earlier'));
  assert.ok(!JSON.stringify(context).includes('PRIVATE_DO_NOT_SHARE'));
  assert.equal(context.defaults.poll.closePolicy.kind, 'host');
  const c = x.meeting.collaboration!.components[0];
  enqueueCollaborationIntents(
    x.meeting,
    [{ ...intent, operation: 'publish', targetId: c.id, collectionMode: 'none' }],
    [],
    'start',
  );
  await new CollaborationRuntime(x.ports).drain();
  const updated = x.meeting.collaboration!.components[0];
  assert.equal(updated.collection!.status, 'stopped');
  assert.equal(updated.draftState, 'ready');
  assert.equal(updated.rounds.length, 0);
});

test('incomplete retrospective generated content is repaired instead of handing the host a blank form', async () => {
  const x = setup();
  let calls = 0;
  enqueueCollaborationIntents(
    x.meeting,
    [
      {
        family: 'poll',
        operation: 'prepare',
        expression: 'explicit',
        resolution: 'actionable_draft',
        targetId: null,
        scopeText: '范围',
        collectionMode: 'retrospective',
        sourceRefs: [],
        objectRefs: [],
      } as any,
    ],
    [],
    'prepare',
  );
  await new CollaborationRuntime({
    ...x.ports,
    generate: async (_input, repair) => {
      calls++;
      if (calls === 1)
        return {
          content: { ...payload, payload: { ...payload.payload, options: [] } },
          clarification: null,
        };
      assert.match(repair!, /MISSING_REQUIRED_FIELDS/);
      return { content: payload, clarification: null };
    },
  }).drain();
  assert.equal(calls, 2);
  assert.equal(x.meeting.collaboration!.components[0].draftState, 'ready');
});
test('late component model output cannot overwrite manual editing', async () => {
  const x = setup(),
    s = x.meeting.collaboration!,
    actor = s.participants[0].id;
  applyCollaborationCommand(s, actor, {
    id: crypto.randomUUID(),
    meetingId: s.meetingId,
    type: 'component.prepare',
    payload: { content: payload },
  });
  const c = s.components[0];
  enqueueCollaborationIntents(
    x.meeting,
    [
      {
        family: 'poll',
        operation: 'update',
        expression: 'explicit',
        resolution: 'actionable_draft',
        targetId: c.id,
        scopeText: '',
        collectionMode: 'none',
        sourceRefs: [],
        objectRefs: [],
      } as any,
    ],
    [],
    'root',
  );
  let release!: (v: unknown) => void;
  let called!: () => void;
  const began = new Promise<void>((r) => {
    called = r;
  });
  const running = new CollaborationRuntime({
    ...x.ports,
    generate: async () => {
      called();
      return await new Promise((r) => {
        release = r;
      });
    },
  }).drain();
  await began;
  const live = x.meeting.collaboration!.components[0];
  applyCollaborationCommand(x.meeting.collaboration!, actor, {
    id: crypto.randomUUID(),
    meetingId: s.meetingId,
    type: 'component.edit_draft',
    payload: {
      componentId: c.id,
      baseDraftRevision: live.draftRevision,
      content: { ...payload, payload: { ...payload.payload, question: '手工问题' } },
    },
  });
  release({ content: payload, clarification: null });
  await running;
  const updated = x.meeting.collaboration!;
  assert.equal(
    (updated.components[0].revisions.at(-1)!.content as any).payload.question,
    '手工问题',
  );
  assert.equal(updated.jobs.at(-1)!.status, 'superseded');
});
