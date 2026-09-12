import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCollaboration,
  applyCollaborationCommand,
  projectCollaboration,
} from '../../src/domain/collaboration';
import { emptyContent } from '../../src/contracts/collaboration';

const poll = {
  kind: 'poll',
  payload: {
    question: '先做哪个？',
    contextSummary: '',
    options: [
      { id: 'a', label: '内部试点', description: '', objectRefs: [] },
      { id: 'b', label: '客户试点', description: '', objectRefs: [] },
    ],
    selection: { mode: 'single', min: 1, max: 1 },
    allowAbstain: true,
    resultsVisibility: 'after_close',
    closePolicy: { kind: 'host' },
  },
};
function setup(content: unknown = poll) {
  const s = createCollaboration('meeting', ['甲', '乙', '丙']);
  const host = s.participants[0].id;
  const people = s.participants.slice(1).map((p) => p.id);
  const run = (actor: string, type: string, payload: any = {}) =>
    applyCollaborationCommand(s, actor, {
      id: crypto.randomUUID(),
      meetingId: 'meeting',
      type,
      payload,
    });
  run(host, 'component.prepare', { content });
  const c = s.components[0];
  const publish = () =>
    run(host, 'component.publish', {
      componentId: c.id,
      draftRevision: c.draftRevision,
      expectedAggregateVersion: c.aggregateVersion,
      audienceIds: people,
      sourceDisclosure: [],
    });
  publish();
  const respond = (who: string, response: unknown, version = 0, revision = c.publishedRevision) =>
    run(who, 'component.respond', {
      componentId: c.id,
      publishedRevision: revision,
      expectedResponseVersion: version,
      response,
    });
  return { s, c, host, people, run, respond, publish };
}
test('votes are private until close; change vote replaces the current count', () => {
  const x = setup();
  x.respond(x.people[0], { kind: 'vote', optionIds: ['a'] });
  x.respond(x.people[1], { kind: 'vote', optionIds: ['a'] });
  x.respond(x.people[1], { kind: 'vote', optionIds: ['b'] }, 1);
  const open = projectCollaboration(x.s, x.host).components[0];
  assert.equal(open.result, null);
  assert.equal(JSON.stringify(projectCollaboration(x.s, x.people[2])).includes('optionIds'), false);
  x.run(x.host, 'component.close', {
    componentId: x.c.id,
    publishedRevision: x.c.publishedRevision,
    expectedAggregateVersion: x.c.aggregateVersion,
  });
  const result = projectCollaboration(x.s, x.people[0]).components[0].result as any;
  assert.deepEqual(
    result.counts.map((n: any) => n.count),
    [1, 1],
  );
  assert.equal(result.pending, 1);
  assert.equal(result.tied, true);
});
test('participant cannot publish, impersonate another actor, or see drafts', () => {
  const x = setup();
  assert.throws(
    () => x.run(x.people[0], 'component.close', { componentId: x.c.id }),
    /UNAUTHORIZED/,
  );
  assert.throws(() =>
    x.respond(x.people[0], { kind: 'vote', optionIds: ['a'], actorId: x.people[1] }),
  );
  x.run(x.host, 'component.prepare', { content: poll });
  assert.equal(projectCollaboration(x.s, x.people[0]).components.length, 1);
  assert.equal(projectCollaboration(x.s, x.host).components.length, 2);
});
test('replacement rejects old votes and does not carry votes into the new round', () => {
  const x = setup();
  const old = x.c.publishedRevision;
  x.respond(x.people[0], { kind: 'vote', optionIds: ['a'] });
  x.run(x.host, 'component.edit_draft', {
    componentId: x.c.id,
    baseDraftRevision: x.c.draftRevision,
    content: { ...poll, payload: { ...poll.payload, question: '最终选择？' } },
  });
  x.publish();
  assert.throws(
    () => x.respond(x.people[0], { kind: 'vote', optionIds: ['a'] }, 1, old),
    /ROUND_REPLACED/,
  );
  assert.equal(projectCollaboration(x.s, x.people[0]).components[0].ownResponses.length, 0);
});
test('same-person concurrent change loses while different people can both submit', () => {
  const x = setup();
  x.respond(x.people[0], { kind: 'vote', optionIds: ['a'] });
  assert.throws(
    () => x.respond(x.people[0], { kind: 'vote', optionIds: ['b'] }),
    /RESPONSE_VERSION_CONFLICT/,
  );
  x.respond(x.people[1], { kind: 'abstain' });
  assert.equal(projectCollaboration(x.s, x.host).components[0].responded, 2);
});
test('decision requires every named participant and no pending analysis', () => {
  const x = setup({
    kind: 'decision_confirmation',
    payload: {
      statement: '按方案A执行',
      scopeText: '本次试点',
      conditions: [],
      targetObjectRefs: [],
      supportingResults: [],
      requiredParticipantIds: [],
      rule: 'all_required_explicit_agree',
    },
  });
  const record = () =>
    x.run(x.host, 'component.record_decision', {
      componentId: x.c.id,
      publishedRevision: x.c.publishedRevision,
      expectedAggregateVersion: x.c.aggregateVersion,
    });
  x.respond(x.people[0], { kind: 'agree' });
  assert.throws(record, /CONFIRMATION_INCOMPLETE/);
  x.respond(x.people[1], { kind: 'agree' });
  x.respond(x.people[2], { kind: 'agree' });
  x.c.requiredAnalysisSequence = 4;
  assert.throws(record, /ANALYSIS_INCOMPLETE/);
  x.c.validatedAnalysisSequence = 4;
  record();
  assert.equal(x.s.decisions.length, 1);
  assert.equal(x.s.decisions[0].participantIds.length, 3);
  assert.throws(
    () => x.respond(x.people[0], { kind: 'disagree', reason: '改主意' }, 1),
    /ROUND_CLOSED/,
  );
});
test('invalid poll options and off-list voters cannot publish or vote', () => {
  const x = setup();
  assert.throws(() => x.respond(x.host, { kind: 'vote', optionIds: ['a'] }), /NOT_IN_AUDIENCE/);
  assert.throws(
    () => x.respond(x.people[0], { kind: 'vote', optionIds: ['a', 'b'] }),
    /INVALID_SELECTION/,
  );
  assert.throws(
    () => x.respond(x.people[0], { kind: 'vote', optionIds: ['unknown'] }),
    /INVALID_SELECTION/,
  );
});

test('only the original reporter can resolve an objection, retaining its evidence', () => {
  const content = emptyContent('decision_confirmation');
  if (content.kind !== 'decision_confirmation') throw Error();
  content.payload.statement = '选择内部试点';
  content.payload.scopeText = '本次试点';
  const x = setup(content);
  x.respond(x.people[0], { kind: 'reserve', reason: '尚未安排负责人' });
  const report = x.s.responses[0];
  const payload = {
    componentId: x.c.id,
    reportId: report.id,
    expectedReportVersion: 1,
    reason: '负责人已明确',
  };
  assert.throws(() => x.run(x.host, 'component.resolve_report', payload), /UNAUTHORIZED/);
  x.run(x.people[0], 'component.resolve_report', payload);
  assert.equal(report.resolved, true);
  assert.equal(report.response.kind, 'reserve');
  assert.equal(x.s.events.at(-1)?.type, 'report.resolved');
});

test('a recorded decision accepts a new issue after meeting end without reopening the vote', () => {
  const x = setup({
    kind: 'decision_confirmation',
    payload: {
      statement: '执行A',
      scopeText: '试点',
      conditions: [],
      targetObjectRefs: [],
      supportingResults: [],
      requiredParticipantIds: [],
      rule: 'all_required_explicit_agree',
    },
  });
  for (const actor of x.people) x.respond(actor, { kind: 'agree' });
  x.run(x.host, 'component.record_decision', {
    componentId: x.c.id,
    publishedRevision: 1,
    expectedAggregateVersion: x.c.aggregateVersion,
  });
  x.s.ended = true;
  x.run(x.people[0], 'component.report_new_issue', {
    componentId: x.c.id,
    decisionId: x.s.decisions[0].id,
    text: '新收到交付约束',
  });
  assert.equal(x.s.decisions[0].reviewRequired, true);
  assert.equal(x.c.rounds[0].status, 'closed');
  assert.equal(x.s.events.at(-1)?.type, 'decision.issue_reported');
});

test('conflict evidence requires explicit disclosure before publishing', () => {
  const x = setup();
  x.s.conflicts.push({
    id: 'f',
    revision: 1,
    fingerprint: 'f',
    type: 'participant_objection',
    basis: 'participant_reported',
    verification: 'supported',
    resolution: 'unresolved',
    summary: '异议',
    impact: '',
    objectRefs: [],
    evidence: [],
    affectedParticipantIds: [],
    coverage: 'complete',
    componentIds: [],
  });
  const evidence = { kind: 'response', responseId: 'private-response', responseVersion: 1 };
  const componentId = x.run(x.host, 'component.prepare', {
    content: {
      kind: 'conflict',
      payload: {
        conflictRefs: [{ id: 'f', rev: 1 }],
        sides: [
          {
            id: 'side',
            title: '待核对',
            description: '私有说明',
            objectRefs: [],
            evidence: [evidence],
          },
        ],
        questions: [],
        resolutions: [],
      },
    },
  });
  const c = x.s.components.at(-1)!;
  assert.throws(
    () =>
      x.run(x.host, 'component.publish', {
        componentId,
        draftRevision: c.draftRevision,
        expectedAggregateVersion: c.aggregateVersion,
        audienceIds: x.people,
        sourceDisclosure: [],
      }),
    /SOURCE_NOT_SHAREABLE/,
  );
});
