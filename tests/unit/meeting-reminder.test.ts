import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MeetingReminder, BUBBLE_DURATION_MS } from '../../src/desktop/meeting-reminder';
import { SystemReminder } from '../../src/desktop/system-reminder';
import { resolvePreferences } from '../../src/domain/preferences';
import { defaults } from '../../src/service/store';
import copy from '../../docs/design/ui-copy.json';

function fixture(t: any) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  let ctx: any = { enabled: true, launcherVisible: true, available: true };
  const views: any[] = [],
    recoveries: any[] = [];
  let starts = 0;
  let start = async (valid: () => boolean): Promise<any> => {
    assert.equal(valid(), true);
    starts++;
    ctx.active = { id: 'meeting', capture: 'starting' };
    return { meetingId: 'meeting', state: 'starting' };
  };
  const reminder = new MeetingReminder({
    context: () => ctx,
    present: (v) => views.push(v),
    start: (valid) => start(valid),
    recover: (e) => recoveries.push(e),
  });
  t.after(() => reminder.clear());
  const signal = (id = 'episode', revision = 1, present = true, ttl = 60000) =>
    reminder.receive({ id, revision, present, expiresAt: Date.now() + ttl });
  return {
    reminder,
    signal,
    ctx,
    views,
    recoveries,
    starts: () => starts,
    setStart: (fn: typeof start) => {
      start = fn;
    },
  };
}

test('bubble expires after eight unheld seconds, with no capture or repeat on renewed signal', (t) => {
  const f = fixture(t);
  assert.equal(f.signal(), true);
  t.mock.timers.tick(BUBBLE_DURATION_MS - 1);
  assert.equal(f.reminder.current?.phase, 'prompt');
  t.mock.timers.tick(1);
  assert.equal(f.reminder.current, null);
  assert.equal(f.signal('episode', 2), false);
  assert.equal(f.starts(), 0);
});
test('pointer/focus hold pauses remaining display time, but never extends signal validity', (t) => {
  const f = fixture(t);
  f.signal();
  t.mock.timers.tick(3000);
  f.reminder.hold('episode', true);
  t.mock.timers.tick(10000);
  assert.ok(f.reminder.current);
  f.reminder.hold('episode', false);
  t.mock.timers.tick(4999);
  assert.ok(f.reminder.current);
  t.mock.timers.tick(1);
  assert.equal(f.reminder.current, null);
  f.signal('short', 1, true, 1000);
  f.reminder.hold('short', true);
  t.mock.timers.tick(1000);
  assert.equal(f.reminder.current, null);
});
test('native route uses signal expiry, close and stale clicks cannot record', async (t) => {
  const f = fixture(t);
  f.ctx.launcherVisible = false;
  f.signal();
  assert.equal(f.reminder.current?.channel, 'system');
  t.mock.timers.tick(9000);
  assert.ok(f.reminder.current);
  f.reminder.dismiss('episode');
  assert.equal(await f.reminder.accept('episode'), false);
  f.signal('short', 1, true, 1000);
  t.mock.timers.tick(1000);
  assert.equal(await f.reminder.accept('short'), false);
  assert.equal(f.starts(), 0);
});
test('click is consumed synchronously; recording feedback waits for captureReady', async (t) => {
  const f = fixture(t);
  f.signal();
  const first = f.reminder.accept('episode');
  assert.equal(await f.reminder.accept('episode'), false);
  await first;
  assert.equal(f.starts(), 1);
  assert.equal(f.reminder.current?.phase, 'starting');
  f.ctx.active.capture = 'capturing';
  f.reminder.synchronize();
  assert.equal(f.reminder.current?.phase, 'recording');
  t.mock.timers.tick(1600);
  assert.equal(f.reminder.current, null);
  assert.equal(f.ctx.active.capture, 'capturing');
});
test('active/paused meeting, unavailable service, disabled reminders suppress candidates without queueing', (t) => {
  const f = fixture(t);
  for (const capture of ['starting', 'capturing', 'paused', 'input_error']) {
    f.ctx.active = { id: 'm', capture };
    assert.equal(f.signal(capture), false);
  }
  delete f.ctx.active;
  f.ctx.enabled = false;
  assert.equal(f.signal('disabled'), false);
  f.ctx.enabled = true;
  assert.equal(f.signal('disabled', 2), false);
  f.ctx.available = false;
  assert.equal(f.signal('unavailable'), false);
  assert.equal(f.starts(), 0);
});
test('switching visibility dismisses a delivered prompt without switching channels or re-alerting', (t) => {
  const f = fixture(t);
  f.signal();
  f.ctx.launcherVisible = false;
  f.reminder.synchronize();
  assert.equal(f.reminder.current, null);
  assert.equal(f.signal('episode', 2), false);
  f.signal('new');
  assert.equal(f.views.at(-1)?.channel, 'system');
});
test('invalid, expired, out-of-order or withdrawn candidates never authorize recording', async (t) => {
  const f = fixture(t);
  assert.equal(f.reminder.receive({ id: 'bad', present: true }), false);
  assert.equal(f.signal('future', 1, true, 120001), false);
  assert.equal(f.signal('past', 1, true, -1), false);
  f.signal('episode', 3);
  assert.equal(f.signal('episode', 2, false), false);
  assert.ok(f.reminder.current);
  f.signal('episode', 4, false);
  assert.equal(await f.reminder.accept('episode'), false);
  assert.equal(f.signal('episode', 5), false);
});
test('signal is checked again across async preflight; stale consent cannot create an event', async (t) => {
  const f = fixture(t);
  f.signal();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.setStart(async (valid) => {
    await waiting;
    return { meetingId: null, state: valid() ? 'unexpected' : 'stale' };
  });
  const clicked = f.reminder.accept('episode');
  f.signal('episode', 2, false);
  release();
  assert.equal(await clicked, false);
  assert.equal(f.reminder.current, null);
});
test('setup and start failure expose recovery, never claim recording; hide does not cancel consented start', async (t) => {
  const f = fixture(t);
  f.signal();
  f.setStart(async () => ({
    meetingId: null,
    state: 'needs_setup',
    reason: 'AUDIO_SETUP_REQUIRED',
  }));
  await f.reminder.accept('episode');
  assert.deepEqual(f.recoveries, ['AUDIO_SETUP_REQUIRED']);
  assert.equal(f.reminder.current, null);
  f.signal('failure');
  f.setStart(async () => {
    throw new Error('SERVICE_UNAVAILABLE');
  });
  await f.reminder.accept('failure');
  assert.equal(f.recoveries.at(-1), 'SERVICE_UNAVAILABLE');
});
test('hiding launcher and turning off reminders do not stop a consented recording', async (t) => {
  const f = fixture(t);
  f.signal();
  await f.reminder.accept('episode');
  f.ctx.launcherVisible = false;
  f.ctx.enabled = false;
  f.reminder.synchronize();
  assert.equal(f.reminder.current?.channel, 'system');
  assert.equal(f.ctx.active.capture, 'starting');
  f.ctx.active.capture = 'capturing';
  f.reminder.synchronize();
  assert.equal(f.ctx.active.capture, 'capturing');
});
test('preferences migrate without changing audio and both dictionaries share reminder labels', () => {
  const legacy = { ...defaults };
  delete legacy.launcherVisible;
  delete legacy.meetingReminders;
  const prefs = resolvePreferences(legacy, 'zh-Hans');
  assert.equal(prefs.launcherVisible, true);
  assert.equal(prefs.meetingReminders, true);
  const hidden = resolvePreferences(
    { ...prefs, launcherVisible: false, meetingReminders: false },
    'en',
  );
  assert.equal(hidden.launcherVisible, false);
  assert.deepEqual(hidden.audio, prefs.audio);
  assert.equal(copy['zh-CN']['reminder.title'], '你可能正在开会');
  assert.equal(copy.en['reminder.title'], 'You might be in a meeting');
  assert.deepEqual(Object.keys(copy.en).sort(), Object.keys(copy['zh-CN']).sort());
});
test('native notification click/close/failure share guards; removed notification callbacks are inert', () => {
  const notifications: any[] = [],
    clicks: string[] = [],
    dismissals: string[] = [];
  let supported = true,
    failures = 0;
  const system = new SystemReminder({
    supported: () => supported,
    create: (options) => {
      const n = Object.assign(new EventEmitter(), {
        options,
        shown: false,
        closed: false,
        show() {
          this.shown = true;
        },
        close() {
          this.closed = true;
        },
      });
      notifications.push(n);
      return n;
    },
    accept: (id) => clicks.push(id),
    dismiss: (id) => dismissals.push(id),
    failed: () => {
      failures++;
    },
  });
  system.show('a', 'title', 'body');
  system.show('a', 'title', 'body');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].options.silent, true);
  notifications[0].emit('click');
  notifications[0].emit('click');
  assert.deepEqual(clicks, ['a']);
  system.show('b', 'title', 'body');
  notifications[1].emit('close');
  notifications[1].emit('click');
  assert.deepEqual(dismissals, ['b']);
  system.show('c', 'title', 'body');
  notifications[2].emit('failed');
  assert.equal(failures, 1);
  assert.equal(dismissals.at(-1), 'c');
  supported = false;
  system.show('d', 'title', 'body');
  assert.equal(notifications.length, 3);
  assert.equal(dismissals.at(-1), 'd');
});

test('a concurrent existing idle meeting is not resumed or reported as connecting', async (t) => {
  const f = fixture(t);
  f.signal();
  f.setStart(async () => ({ meetingId: 'existing', state: 'idle' }));
  assert.equal(await f.reminder.accept('episode'), false);
  assert.equal(f.reminder.current, null);
  assert.equal(f.starts(), 0);
});
