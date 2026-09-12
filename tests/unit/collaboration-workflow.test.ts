import test from 'node:test';
import assert from 'node:assert/strict';
import { runComponentWorkflow, runImpactWorkflow } from '../../src/agent/collaboration';
import { detectCollaborationConflicts } from '../../src/domain/collaboration-conflicts';
import { createCollaboration, applyCollaborationCommand } from '../../src/domain/collaboration';

const content = {
  kind: 'poll',
  payload: {
    question: '选哪个方案？',
    contextSummary: '',
    options: [
      { id: 'a', label: 'A', description: '', objectRefs: [] },
      { id: 'b', label: 'B', description: '', objectRefs: [] },
    ],
    selection: { mode: 'single', min: 1, max: 1 },
    allowAbstain: true,
    resultsVisibility: 'after_close',
    closePolicy: { kind: 'host' },
  },
};
test('component graph validates and returns a draft, never publishes it', async () => {
  let calls = 0;
  const trace: string[] = [];
  const result = await runComponentWorkflow({
    remaining: () => 2 - calls,
    generate: async () => {
      calls++;
      return { content, clarification: null };
    },
    validate: () => {},
    trace: (node) => trace.push(node),
  });
  assert.equal(result.content?.kind, 'poll');
  assert.deepEqual(trace, ['assemble', 'validate']);
  assert.equal(calls, 1);
});
test('component graph repairs malformed output once and respects its persistent budget', async () => {
  let calls = 0;
  const result = await runComponentWorkflow({
    remaining: () => 2 - calls,
    generate: async () => {
      calls++;
      return calls === 1 ? { bad: true } : { content, clarification: null };
    },
    validate: () => {},
  });
  assert.equal(result.content?.kind, 'poll');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    runComponentWorkflow({
      remaining: () => 1 - calls,
      generate: async () => {
        calls++;
        return { bad: true };
      },
      validate: () => {},
    }),
  );
  assert.equal(calls, 1);
});
test('rules-only impact graph avoids model invocation', async () => {
  const trace: string[] = [];
  const result = await runImpactWorkflow({
    rules: () => [],
    semanticNeeded: false,
    remaining: () => 2,
    analyze: async () => {
      throw Error('UNEXPECTED_MODEL');
    },
    trace: (node) => trace.push(node),
  });
  assert.deepEqual(result, []);
  assert.deepEqual(trace, ['rules']);
});
test('exclusive interval overlap is detected; equal due dates alone are not conflict evidence', () => {
  const s = createCollaboration('meeting', ['A']);
  const host = s.participants[0].id,
    person = s.participants[1].id;
  const make = (id: string, interval: boolean) => ({
    id,
    itemRevision: 1,
    taskRef: null,
    title: id,
    deliverable: '交付物',
    assigneeId: person,
    unresolvedAssigneeText: null,
    collaboratorIds: [],
    schedule: {
      rawText: '9月12日',
      timezone: 'UTC',
      start: interval ? '2026-09-12T09:00:00.000Z' : null,
      end: interval ? '2026-09-12T10:00:00.000Z' : null,
      dueDate: interval ? null : '2026-09-12',
      dueAt: null,
      precision: interval ? 'interval' : 'date',
      exclusive: interval ? true : null,
    },
    dependencyRefs: [],
    discussionPoints: [],
    conflictIds: [],
  });
  applyCollaborationCommand(s, host, {
    id: crypto.randomUUID(),
    meetingId: 'meeting',
    type: 'component.prepare',
    payload: {
      content: {
        kind: 'assignment',
        payload: { mode: 'display', items: [make('t1', false), make('t2', false)] },
      },
    },
  });
  assert.equal(detectCollaborationConflicts(s).length, 0);
  const c = s.components[0];
  applyCollaborationCommand(s, host, {
    id: crypto.randomUUID(),
    meetingId: 'meeting',
    type: 'component.edit_draft',
    payload: {
      componentId: c.id,
      baseDraftRevision: c.draftRevision,
      content: {
        kind: 'assignment',
        payload: { mode: 'display', items: [make('t1', true), make('t2', true)] },
      },
    },
  });
  const conflicts = detectCollaborationConflicts(s);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, 'time_overlap');
  assert.equal(conflicts[0].basis, 'rule');
});
