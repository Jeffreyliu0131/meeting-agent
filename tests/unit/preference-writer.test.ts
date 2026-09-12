import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PreferenceWriter } from '../../src/ui/preference-writer';
import { patchPreferences } from '../../src/domain/preferences';
import { defaults } from '../../src/service/store';

test('field patches preserve independent and nested audio preferences', () => {
  const audio = { ...defaults.audio!, deviceId: 'saved-device', deviceLabel: 'Saved' };
  const before = { ...defaults, audio, uiLanguage: 'zh-CN' as const };
  const after = patchPreferences(
    before,
    { launcherVisible: false, audio: { includeComputerAudio: true } },
    'en',
  );
  assert.equal(after.audio?.deviceId, 'saved-device');
  assert.equal(after.audio?.includeComputerAudio, true);
  assert.equal(after.uiLocale, 'zh-CN');
  assert.throws(() => patchPreferences(before, { launcherVisible: 'no' }, 'en'));
  assert.throws(() => patchPreferences(before, { invented: true }, 'en'));
});
test('rapid toggles serialize while latest intent stays visible over server snapshots', async () => {
  let server = { ...defaults },
    release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const writer = new PreferenceWriter(server, async (patch) => {
    calls++;
    if (calls === 1) await blocked;
    server = patchPreferences(server, patch, 'en');
    return server;
  });
  const a = writer.change({ launcherVisible: false });
  const b = writer.change({ launcherVisible: true });
  const c = writer.change({ meetingReminders: false });
  writer.receive({ ...defaults, reduceMotion: true });
  assert.equal(writer.value.launcherVisible, true);
  assert.equal(writer.value.meetingReminders, false);
  assert.equal(calls, 1);
  release();
  await Promise.all([a, b, c]);
  assert.equal(server.launcherVisible, true);
  assert.equal(server.meetingReminders, false);
  assert.equal(writer.busy, false);
});
test('failed field rolls back while other changes survive; retry saves the failed intent', async () => {
  let server = { ...defaults },
    fail = true;
  const writer = new PreferenceWriter(server, async (patch) => {
    if ('launcherVisible' in patch && fail) throw new Error('STORAGE_FAILED');
    server = patchPreferences(server, patch, 'en');
    return server;
  });
  const failed = writer.change({ launcherVisible: false });
  const other = writer.change({ reduceMotion: true });
  assert.equal(await failed, false);
  await other;
  assert.equal(writer.value.launcherVisible, true);
  assert.equal(writer.value.reduceMotion, true);
  assert.equal(writer.error, 'STORAGE_FAILED');
  assert.equal(await writer.flush(), false);
  fail = false;
  await writer.retry();
  assert.equal(writer.value.launcherVisible, false);
  assert.equal(writer.error, '');
});
test('superseded failed toggle does not leave an error for an already-saved newer choice', async () => {
  let calls = 0,
    release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = new PreferenceWriter({ ...defaults }, async (patch) => {
    if (++calls === 1) {
      await blocked;
      throw new Error('STORAGE_FAILED');
    }
    return patchPreferences(defaults, patch, 'en');
  });
  const first = writer.change({ launcherVisible: false });
  const last = writer.change({ launcherVisible: true });
  release();
  await Promise.all([first, last]);
  assert.equal(writer.value.launcherVisible, true);
  assert.equal(writer.error, '');
});

test('different audio subfields do not conceal a failed device change', async () => {
  let server = { ...defaults };
  const writer = new PreferenceWriter(server, async (patch) => {
    if (patch.audio?.deviceId) throw new Error('STORAGE_FAILED');
    server = patchPreferences(server, patch, 'en');
    return server;
  });
  const device = writer.change({ audio: { deviceId: 'uncommitted-device', setupCompleted: true } });
  const channel = writer.change({ audio: { includeComputerAudio: true, setupCompleted: true } });
  await Promise.all([device, channel]);
  assert.equal(writer.value.audio?.deviceId, 'default');
  assert.equal(writer.value.audio?.includeComputerAudio, true);
  assert.equal(writer.error, 'STORAGE_FAILED');
});
