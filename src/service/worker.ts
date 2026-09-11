import { SQLiteStore } from './store';
import { SessionService } from './session';
import { OpenAIProvider, configFromEnv } from '../agent/provider';
import type { AudioLease } from '../integrations/audio-leases';
import { acceptAudio } from '../integrations/audio-leases';
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
const transcribing = new Map<string, Promise<unknown>>();
const leases = new Map<string, AudioLease>();
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
      await Promise.race([
        Promise.allSettled([...transcribing.values()]),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
      for (const lease of leases.values())
        service.recordInputGap(lease, 'TRANSCRIPTION_INTERRUPTED');
      value = true;
    } else if (method === 'snapshot') value = service.snapshot();
    else if (method === 'command') value = service.command(args);
    else if (method === 'translate') {
      const { meetingId, segmentId, revision, targetLocale } = args;
      const m = service.meetings.find((m) => m.id === meetingId);
      const source = m?.segments.find((s) => s.id === segmentId && s.rev === revision);
      if (!source || !['en', 'zh-CN'].includes(targetLocale)) throw new Error('INVALID_SOURCE');
      const text = await provider.translate(source.text, targetLocale);
      value = service.saveTranslation(meetingId, {
        segmentId,
        sourceRev: revision,
        targetLocale,
        text,
        createdAt: new Date().toISOString(),
      });
    } else if (method === 'audio') {
      const { meetingId, epoch, channel, wav, segmentId } = args;
      const m = service.meetings.find((m) => m.id === meetingId);
      const lease = acceptAudio(m, epoch, channel, segmentId);
      if (!['microphone', 'system_audio'].includes(channel)) throw new Error('INVALID_CHANNEL');
      if (!(wav instanceof Uint8Array) || wav.length > 2_000_000) throw new Error('INVALID_AUDIO');
      const key = meetingId + channel;
      if (transcribing.has(key)) throw new Error('TRANSCRIPTION_BACKLOG');
      const task = provider.transcribe(wav);
      transcribing.set(key, task);
      leases.set(key, lease);
      try {
        const text = await task;
        if (text) value = service.completeAudio(lease, text);
      } catch (error) {
        service.recordInputGap(lease, 'TRANSCRIPTION_FAILED');
        throw error;
      } finally {
        transcribing.delete(key);
        leases.delete(key);
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
