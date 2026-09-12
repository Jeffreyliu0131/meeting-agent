import { SQLiteStore } from './store';
import { SessionService } from './session';
import { OpenAIProvider, configFromEnv } from '../agent/provider';
import type { AudioLease } from '../integrations/audio-leases';
import { TranscriptionQueue } from '../integrations/transcription-queue';
import { acceptAudio } from '../integrations/audio-leases';
import { LiveTranscription } from '../integrations/live-transcription';
const parent = (process as any).parentPort;
const previews = new Map<
  string,
  { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
const preview = (artifact: import('../contracts/model').Artifact) =>
  new Promise<void>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      previews.delete(id);
      reject(new Error('RENDER_TIMEOUT'));
    }, 5000);
    previews.set(id, { resolve, reject, timer });
    parent.postMessage({ type: 'preview', id, artifact });
  });
const config = configFromEnv();
const provider = new OpenAIProvider(config);
const service = new SessionService(
  new SQLiteStore(process.env.MEETING_DB!),
  provider,
  config,
  () => parent.postMessage({ type: 'snapshot', value: service.snapshot() }),
  preview,
);
const liveStreams = new Map<
  string,
  { meetingId: string; epoch: number; stream: LiveTranscription }
>();
const pendingAudio = () =>
  service.audioQueueChanged(
    audioQueue.pending +
      [...liveStreams.values()].reduce((n, entry) => n + entry.stream.pending, 0),
  );
async function finishLive(meetingId?: string, epoch?: number) {
  await Promise.all(
    [...liveStreams.entries()]
      .filter(
        ([, entry]) =>
          (!meetingId || entry.meetingId === meetingId) &&
          (epoch === undefined || entry.epoch === epoch),
      )
      .map(async ([key, entry]) => {
        await entry.stream.finish();
        liveStreams.delete(key);
      }),
  );
  pendingAudio();
}
const audioQueue = new TranscriptionQueue<{
  lease: AudioLease;
  wav: Uint8Array;
  bytes: number;
  durationMs: number;
}>(
  async (item) => {
    const text = await service.runCall(
      item.lease.meetingId,
      'transcribe',
      (options) => provider.transcribe(item.wav, options),
      item.durationMs / 1000,
    );
    if (text) service.completeAudio(item.lease, text);
  },
  (item, code) => service.recordInputGap(item.lease, code),
  () => pendingAudio(),
);
parent.on('message', async ({ data }: any) => {
  const { id, method, args } = data;
  if (method === 'previewResult') {
    const p = previews.get(id);
    if (p) {
      clearTimeout(p.timer);
      previews.delete(id);
      args.ok ? p.resolve() : p.reject(new Error('RENDER_FAILED'));
    }
    return;
  }
  try {
    let value: unknown;
    if (method === 'shutdown') {
      await finishLive();
      await Promise.race([audioQueue.idle(), new Promise((r) => setTimeout(r, 2000))]);
      audioQueue.close();
      value = true;
    } else if (method === 'snapshot') value = service.snapshot();
    else if (method === 'command') {
      value = service.command(args);
      if (['pause', 'end', 'captureError'].includes(args.type)) void finishLive(args.meetingId);
    } else if (method === 'audioDrain') {
      await finishLive(args.meetingId, args.epoch);
      value = true;
    } else if (method === 'translate') {
      const { meetingId, segmentId, revision, targetLocale } = args;
      const m = service.meetings.find((m) => m.id === meetingId);
      const source = m?.segments.find((s) => s.id === segmentId && s.rev === revision);
      if (!source || !['en', 'zh-CN'].includes(targetLocale)) throw new Error('INVALID_SOURCE');
      const text = await service.runCall(meetingId, 'translate', (options) =>
        provider.translate(source.text, targetLocale, options),
      );
      value = service.saveTranslation(meetingId, {
        segmentId,
        sourceRev: revision,
        targetLocale,
        text,
        createdAt: new Date().toISOString(),
      });
    } else if (method === 'audio') {
      const { meetingId, epoch, channel, wav, segmentId, timing } = args;
      const m = service.meetings.find((m) => m.id === meetingId);
      const lease = acceptAudio(m, epoch, channel, segmentId, timing);
      if (!(wav instanceof Uint8Array) || wav.length < 44 || wav.length > 2000000)
        throw new Error('INVALID_AUDIO');
      const rate = new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getUint32(24, true);
      if (![16000, 24000, 44100, 48000].includes(rate)) throw new Error('INVALID_AUDIO');
      const durationMs = ((wav.length - 44) / 2 / rate) * 1000;
      if (config.sttModel === 'gpt-live-transcribe') {
        if (rate !== 24000 || wav.length > 48044) throw new Error('INVALID_AUDIO');
        const key = meetingId + ':' + epoch + ':' + channel;
        let entry = liveStreams.get(key);
        if (!entry) {
          const stream = new LiveTranscription(
            { key: config.sttKey, base: config.sttBase, model: config.sttModel },
            {
              run: (lease, seconds, run) =>
                service.runCall(lease.meetingId, 'transcribe', run, seconds),
              partial: (lease, text) => service.partialAudio(lease, text),
              complete: (lease, text) => service.completeAudio(lease, text),
              gap: (lease, code) => service.recordInputGap(lease, code),
              failed: (code) => parent.postMessage({ type: 'sttError', meetingId, epoch, code }),
              changed: pendingAudio,
            },
          );
          entry = { meetingId, epoch, stream };
          liveStreams.set(key, entry);
        }
        const accepted = entry.stream.append(lease, wav.subarray(44));
        if (!accepted) throw new Error('TRANSCRIPTION_FAILED');
        value = { accepted, pending: entry.stream.pending };
      } else {
        const accepted = audioQueue.enqueue(meetingId + ':' + epoch + ':' + channel, {
          lease,
          wav,
          bytes: wav.length,
          durationMs,
        });
        value = { accepted, pending: audioQueue.pending };
      }
    } else throw new Error('INVALID_METHOD');
    parent.postMessage({ id, ok: true, value });
  } catch (error) {
    const raw = error instanceof Error ? error.message : '';
    parent.postMessage({
      id,
      ok: false,
      error: /^[A-Z0-9_]+$/.test(raw) ? raw : 'INVALID_REQUEST',
    });
  }
});
parent.postMessage({ type: 'ready' });
