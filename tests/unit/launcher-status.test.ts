import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launcherIndicator, readyComponents } from '../../src/ui/launcher-status';
import { createCollaboration, applyCollaborationCommand } from '../../src/domain/collaboration';

test('component notification appears only for valid unpublished drafts and preserves recording state', () => {
  const s = createCollaboration('meeting', ['A']);
  const host = s.participants[0].id;
  applyCollaborationCommand(s, host, {
    id: crypto.randomUUID(),
    meetingId: 'meeting',
    type: 'component.prepare',
    payload: {
      content: {
        kind: 'decision_confirmation',
        payload: {
          statement: '执行A方案',
          scopeText: '本次试点',
          conditions: [],
          targetObjectRefs: [],
          supportingResults: [],
          requiredParticipantIds: [],
          rule: 'all_required_explicit_agree',
        },
      },
    },
  });
  assert.equal(readyComponents(s).length, 1);
  assert.equal(launcherIndicator({ capture: 'capturing' }).state, 'listening');
  s.components[0].publishedRevision = s.components[0].draftRevision;
  assert.equal(readyComponents(s).length, 0);
});

test('launcher reports actual capture readiness, pause and errors independently', () => {
  assert.equal(launcherIndicator(undefined).state, 'ready');
  assert.equal(launcherIndicator({ capture: 'idle' }).labelKey, 'launcher.idle');
  assert.equal(launcherIndicator({ capture: 'starting' }).state, 'connecting');
  assert.equal(launcherIndicator({ capture: 'capturing' }).state, 'listening');
  assert.equal(launcherIndicator({ capture: 'paused' }).state, 'paused');
  assert.equal(launcherIndicator({ capture: 'input_error' }).state, 'error');
  assert.equal(launcherIndicator({ capture: 'stopped' }).state, 'ready');
});
test('service failure overrides an outdated green capture snapshot and its text', () => {
  assert.deepEqual(launcherIndicator({ capture: 'capturing' }, true), {
    state: 'error',
    labelKey: 'launcher.serviceError',
  });
});
