import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer, type WebSocket } from 'ws';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { LiveTranscription } from '../../src/integrations/live-transcription';
import type { AudioLease } from '../../src/integrations/audio-leases';

// Only the remote protocol is simulated; the client, PCM handling and lifecycle are real.
function lease(sequence = 0): AudioLease {
  return {
    meetingId: 'meeting-a',
    epoch: 1,
    channel: 'microphone',
    segmentId: `seg-${sequence}`,
    receivedAt: new Date().toISOString(),
    captureStartMs: 1000 + sequence * 100,
    captureEndMs: 1100 + sequence * 100,
    channelSequence: sequence,
  };
}
function pcm(speech = true, samples = 2400) {
  const buffer = Buffer.alloc(samples * 2);
  if (speech) for (let i = 0; i < samples; i++) buffer.writeInt16LE(1000, i * 2);
  return buffer;
}
async function setup(autoComplete = true) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const messages: any[] = [],
    finals: any[] = [],
    partials: any[] = [],
    gaps: any[] = [];
  let remote: WebSocket,
    count = 0;
  server.on('connection', (ws) => {
    remote = ws;
    ws.on('message', (bytes) => {
      const event = JSON.parse(bytes.toString());
      messages.push(event);
      if (event.type === 'session.update') ws.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'input_audio_buffer.append')
        ws.send(
          JSON.stringify({
            type: 'conversation.item.input_audio_transcription.delta',
            item_id: `item-${count}`,
            delta: 'draft',
          }),
        );
      if (event.type === 'input_audio_buffer.commit') {
        const item_id = `item-${count++}`;
        ws.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id }));
        if (autoComplete)
          ws.send(
            JSON.stringify({
              type: 'conversation.item.input_audio_transcription.completed',
              item_id,
              transcript: `final ${item_id}`,
            }),
          );
      }
    });
  });
  const client = new LiveTranscription(
    {
      key: 'test-only',
      base: `http://127.0.0.1:${(server.address() as any).port}`,
      model: 'gpt-live-transcribe',
    },
    {
      run: async (_lease, _seconds, run) => run({}),
      partial: (lease, text) => partials.push({ lease: { ...lease }, text }),
      complete: (lease, text) => finals.push({ lease: { ...lease }, text }),
      gap: (lease, code) => gaps.push({ lease, code }),
      failed: () => {},
      changed: () => {},
    },
  );
  await client.ready;
  return {
    client,
    messages,
    finals,
    partials,
    gaps,
    send: (e: any) => remote.send(JSON.stringify(e)),
    cleanup: async () => {
      client.close();
      for (const ws of server.clients) ws.terminate();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 30));
test('worklet flush stops packet production and retains a short final audio tail', () => {
  let Recorder: any;
  const sent: any[] = [];
  const context = {
    sampleRate: 24000,
    currentFrame: 0,
    Float32Array,
    AudioWorkletProcessor: class {
      port = { postMessage: (packet: any) => sent.push(packet), onmessage: null };
    },
    registerProcessor: (_name: string, implementation: any) => {
      Recorder = implementation;
    },
  };
  runInNewContext(readFileSync('public/pcm-worklet.js', 'utf8'), context);
  const recorder = new Recorder({ processorOptions: { chunkMs: 100 } });
  for (let n = 0; n < 20; n++) {
    context.currentFrame = n * 128;
    recorder.process([[new Float32Array(128).fill(0.1)]], []);
  }
  recorder.port.onmessage({ data: 'flush' });
  const tail = sent.at(-1);
  assert.equal(tail.final, true);
  assert.equal(tail.samples.length, 128);
  const count = sent.length;
  for (let n = 0; n < 20; n++) recorder.process([[new Float32Array(128).fill(0.1)]], []);
  assert.equal(sent.length, count);
});

test('streams PCM before commit, keeps provisional text separate, and drains the last short turn', async () => {
  const s = await setup();
  try {
    s.client.append(lease(), pcm());
    await tick();
    assert.equal(
      s.messages.some((e) => e.type === 'input_audio_buffer.append'),
      true,
    );
    assert.equal(
      s.messages.some((e) => e.type === 'input_audio_buffer.commit'),
      false,
    );
    assert.equal(s.finals.length, 0);
    assert.equal(
      s.partials.some((p) => p.text === 'draft'),
      true,
    );
    await s.client.finish();
    assert.equal(s.finals.length, 1);
    assert.equal(s.finals[0].text, 'final item-0');
    assert.equal(s.finals[0].lease.segmentId, 'seg-0');
    assert.equal(s.client.append(lease(1), pcm()), false);
    assert.equal(s.gaps.length, 0);
  } finally {
    await s.cleanup();
  }
});

test('out-of-order completions keep their own source leases and duplicate events do not duplicate text', async () => {
  const s = await setup(false);
  try {
    s.client.append(lease(), pcm());
    for (let n = 1; n <= 6; n++) s.client.append(lease(n), pcm(false));
    await tick();
    s.client.append(lease(7), pcm());
    const done = s.client.finish();
    await tick();
    s.send({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-1',
      transcript: 'second',
    });
    s.send({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-0',
      transcript: 'first',
    });
    s.send({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-0',
      transcript: 'first',
    });
    await done;
    assert.deepEqual(
      s.finals.map((f) => [f.lease.segmentId, f.text]),
      [
        ['seg-7', 'second'],
        ['seg-0', 'first'],
      ],
    );
    assert.equal(s.finals.find((f) => f.text === 'first').lease.captureEndMs, 1700);
  } finally {
    await s.cleanup();
  }
});

test('failed connection reports an input gap and clears drafts without accepting more audio', async () => {
  const s = await setup(false);
  try {
    s.client.append(lease(), pcm());
    await tick();
    s.send({ type: 'error', error: { code: 'server_error', message: 'untrusted remote detail' } });
    await tick();
    await s.client.finish();
    assert.equal(s.gaps.length, 1);
    assert.equal(s.gaps[0].code, 'TRANSCRIPTION_FAILED');
    assert.equal(s.finals.length, 0);
    assert.equal(s.partials.at(-1).text, '');
    assert.equal(s.client.append(lease(1), pcm()), false);
  } finally {
    await s.cleanup();
  }
});

test('separate audio streams cannot share provisional text or final leases', async () => {
  const a = await setup(),
    b = await setup();
  try {
    a.client.append(lease(), pcm());
    b.client.append({ ...lease(), meetingId: 'meeting-b', channel: 'system_audio' }, pcm());
    await Promise.all([a.client.finish(), b.client.finish()]);
    assert.equal(a.finals[0].lease.meetingId, 'meeting-a');
    assert.equal(b.finals[0].lease.meetingId, 'meeting-b');
    assert.equal(b.finals[0].lease.channel, 'system_audio');
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});
