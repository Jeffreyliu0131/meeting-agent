import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launcherIndicator } from '../../src/ui/launcher-status';

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
