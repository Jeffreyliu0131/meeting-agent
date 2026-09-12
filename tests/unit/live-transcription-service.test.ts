import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { SessionService } from '../../src/service/session';
import { SQLiteStore } from '../../src/service/store';
import { LiveTranscription } from '../../src/integrations/live-transcription';
import type { AudioLease } from '../../src/integrations/audio-leases';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const pcm = (value: number, samples = 2400) => {
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(value, i * 2);
  return buffer;
};
async function setup(maxCallsPerHour = 2400) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const audio: Buffer[] = [];
  let connection = 0;
  server.on('connection', (ws) => {
    const prefix = ++connection;
    let item = 0;
    ws.on('message', (bytes) => {
      const event = JSON.parse(bytes.toString());
      if (event.type === 'session.update') ws.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'input_audio_buffer.append')
        audio.push(Buffer.from(event.audio, 'base64'));
      if (event.type === 'input_audio_buffer.commit') {
        const item_id = `${prefix}:${item++}`;
        ws.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id }));
        ws.send(
          JSON.stringify({
            type: 'conversation.item.input_audio_transcription.completed',
            item_id,
            transcript: `Synthetic ${item_id}`,
          }),
        );
      }
    });
  });
  const service = new SessionService(
    new SQLiteStore(':memory:'),
    {
      interpret: async () => {
        throw Error('UNEXPECTED_MODEL');
      },
    },
    {
      key: '',
      base: 'https://example.invalid',
      model: 'test',
      sttKey: 'test-only',
      sttBase: `http://127.0.0.1:${(server.address() as any).port}`,
      sttModel: 'gpt-live-transcribe',
      format: 'json_schema',
      maxCallsPerHour,
    },
  );
  const meetingId = service.command({
    id: crypto.randomUUID(),
    type: 'create',
    meetingId: null,
    payload: {
      title: 'Synthetic streaming regression',
      mode: 'manual',
      outputLocale: 'en',
      timezone: 'UTC',
    },
  }) as string;
  const streams: LiveTranscription[] = [];
  const finals: { lease: AudioLease; text: string }[] = [];
  const gaps: string[] = [];
  const stream = async () => {
    const client = new LiveTranscription(
      { key: 'test-only', base: service.config.sttBase, model: 'gpt-live-transcribe' },
      {
        run: (lease, seconds, run, signal) =>
          service.runCall(lease.meetingId, 'transcribe', run, seconds, undefined, signal),
        partial: () => {},
        complete: (lease, text) => finals.push({ lease, text }),
        gap: (_lease, code) => gaps.push(code),
        failed: () => {},
        changed: () => {},
      },
    );
    streams.push(client);
    await client.ready;
    return client;
  };
  const lease = (sequence = 0, channel: AudioLease['channel'] = 'microphone'): AudioLease => ({
    meetingId,
    epoch: service.meetings[0].epoch,
    channel,
    segmentId: `${channel}:${sequence}`,
    receivedAt: new Date().toISOString(),
    captureStartMs: sequence * 100,
    captureEndMs: (sequence + 1) * 100,
    channelSequence: sequence,
  });
  const occupy = async () => {
    const releases: (() => void)[] = [];
    const tasks = [0, 1].map(() =>
      service.runCall(
        meetingId,
        'transcribe',
        () => new Promise<void>((resolve) => releases.push(resolve)),
      ),
    );
    await tick();
    assert.equal(releases.length, 2, 'microphone and system audio have separate concurrent slots');
    return async () => {
      releases.forEach((r) => r());
      await Promise.all(tasks);
    };
  };
  const close = async () => {
    streams.forEach((s) => s.close());
    service.close();
    await Promise.all(streams.map((s) => s.finish()));
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { service, stream, lease, occupy, close, audio, finals, gaps };
}

test('actual async service preserves the first PCM packet of every turn and counts its duration', async () => {
  const x = await setup();
  try {
    const s = await x.stream();
    const packets = [pcm(1000), ...Array.from({ length: 6 }, () => pcm(0)), pcm(2000)];
    packets.forEach((p, i) => assert.equal(s.append(x.lease(i), p), true));
    await s.finish();
    assert.deepEqual(Buffer.concat(x.audio), Buffer.concat(packets));
    assert.deepEqual(
      x.finals.map((f) => f.lease.segmentId),
      ['microphone:0', 'microphone:7'],
    );
    assert.deepEqual(
      x.service.meetings[0].calls!.map((c) => c.audioSeconds),
      [0.7, 0.1],
    );
    assert.deepEqual(x.gaps, []);
  } finally {
    await x.close();
  }
});

test('queued authorization retains a short tail, sends no early PCM, and drains once granted', async () => {
  const x = await setup();
  try {
    const release = await x.occupy();
    const s = await x.stream();
    const tail = pcm(3210, 240);
    assert.equal(s.append(x.lease(), tail), true);
    let finished = false;
    const finish = s.finish().then(() => {
      finished = true;
    });
    await tick();
    assert.equal(x.audio.length, 0);
    assert.equal(finished, false);
    await release();
    await finish;
    assert.deepEqual(Buffer.concat(x.audio), Buffer.concat([tail, Buffer.alloc(4320)]));
    assert.equal(x.finals.length, 1);
    assert.equal(x.service.meetings[0].calls!.at(-1)!.audioSeconds, 0.01);
    assert.deepEqual(x.gaps, []);
  } finally {
    await x.close();
  }
});

test('closing a stream cancels queued authorization and never sends the buffered audio later', async () => {
  const x = await setup();
  try {
    const release = await x.occupy();
    const s = await x.stream();
    s.append(x.lease(), pcm(1000));
    s.close();
    await s.finish();
    assert.equal(s.pending, 0);
    assert.deepEqual(x.gaps, ['TRANSCRIPTION_INTERRUPTED']);
    await release();
    await tick();
    assert.equal(x.audio.length, 0);
    assert.equal(x.finals.length, 0);
  } finally {
    await x.close();
  }
});

test('budget rejection records a gap without sending PCM or leaving a pending turn', async () => {
  const x = await setup(0);
  try {
    const s = await x.stream();
    s.append(x.lease(), pcm(1000));
    await s.finish();
    assert.deepEqual(x.gaps, ['AGENT_BUDGET_LIMIT']);
    assert.equal(x.audio.length, 0);
    assert.equal(s.pending, 0);
  } finally {
    await x.close();
  }
});

test('authorization backlog is bounded and overflow cancels all unsent turns explicitly', async () => {
  const x = await setup();
  try {
    const release = await x.occupy();
    const s = await x.stream();
    for (let i = 0; i < 30; i++) assert.equal(s.append(x.lease(i), pcm(1000, 24000)), true);
    assert.equal(s.append(x.lease(30), pcm(1000, 24000)), false);
    await s.finish();
    assert.ok(x.gaps.length > 0);
    assert.ok(x.gaps.every((g) => g === 'TRANSCRIPTION_BACKLOG'));
    await release();
    assert.equal(x.audio.length, 0);
    assert.equal(s.pending, 0);
  } finally {
    await x.close();
  }
});

test('microphone and system audio stream concurrently through the actual service', async () => {
  const x = await setup();
  try {
    const a = await x.stream(),
      b = await x.stream();
    a.append(x.lease(0), pcm(1111));
    b.append(x.lease(0, 'system_audio'), pcm(2222));
    await Promise.all([a.finish(), b.finish()]);
    assert.deepEqual(x.audio.map((p) => p.readInt16LE(0)).sort(), [1111, 2222]);
    assert.deepEqual(x.finals.map((f) => f.lease.channel).sort(), ['microphone', 'system_audio']);
    assert.deepEqual(x.gaps, []);
  } finally {
    await x.close();
  }
});
