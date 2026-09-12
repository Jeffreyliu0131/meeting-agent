import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeeting } from '../../src/domain/commands';
import { defaults } from '../../src/service/store';
import { createCollaboration, applyCollaborationCommand } from '../../src/domain/collaboration';
import { refreshCollaborationIntegrity } from '../../src/domain/collaboration-integrity';

test('corrected source blocks a published response, while unrelated sources do not', () => {
  const m = createMeeting(
    { title: 'Synthetic', mode: 'manual', outputLocale: 'zh-CN', timezone: 'UTC' },
    defaults,
  );
  const s = (m.collaboration = createCollaboration(m.id, ['A']));
  m.segments.push({ id: 'source', rev: 1, text: '选择A或B', kind: 'speech' } as any);
  const actor = s.participants[0].id;
  const run = (type: string, payload: any) =>
    applyCollaborationCommand(s, actor, {
      id: crypto.randomUUID(),
      meetingId: m.id,
      type,
      payload,
    });
  run('component.prepare', {
    content: {
      kind: 'poll',
      payload: {
        question: 'A或B?',
        contextSummary: '',
        options: ['A', 'B'].map((id) => ({ id, label: id, description: '', objectRefs: [] })),
        selection: { mode: 'single', min: 1, max: 1 },
        allowAbstain: true,
        resultsVisibility: 'after_close',
        closePolicy: { kind: 'host' },
      },
    },
    sourceRefs: [{ kind: 'segment', ref: { id: 'source', rev: 1 } }],
  });
  const c = s.components[0];
  run('component.publish', {
    componentId: c.id,
    draftRevision: 1,
    expectedAggregateVersion: c.aggregateVersion,
    audienceIds: [s.participants[1].id],
    sourceDisclosure: [],
  });
  m.segments.push({ id: 'unrelated', rev: 1, text: '天气', kind: 'speech' } as any);
  refreshCollaborationIntegrity(m);
  assert.equal(c.rounds[0].responseGate, 'open');
  m.segments.push({ id: 'source', rev: 2, text: '只有A', kind: 'speech' } as any);
  refreshCollaborationIntegrity(m);
  assert.equal(c.rounds[0].responseGate, 'blocked');
  assert.equal(c.needsReview, true);
  const sequence = s.sequence;
  refreshCollaborationIntegrity(m);
  assert.equal(s.sequence, sequence);
});
