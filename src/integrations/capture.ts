export {};
declare global {
  interface Window {
    meeting: {
      call(method: string, args?: unknown): Promise<any>;
      subscribe(callback: (value: any) => void): () => void;
      onCapture(callback: (value: any) => void): () => void;
    };
  }
}
let cleanup: Array<() => void> = [],
  flushers: Array<() => Promise<void>> = [],
  generation = 0;
function stop() {
  generation++;
  for (const dispose of cleanup) dispose();
  cleanup = [];
  flushers = [];
}
function wav(samples: Float32Array, rate: number) {
  const bytes = new ArrayBuffer(44 + samples.length * 2),
    v = new DataView(bytes);
  const text = (offset: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Uint8Array(bytes);
}
window.meeting.onCapture(async ({ action, meetingId, epoch, mode, deviceId }: any) => {
  if (action === 'drain') {
    await Promise.all(flushers.map((flush) => flush()));
    stop();
    await window.meeting.call('captureStopped');
    return;
  }
  stop();
  if (action !== 'start') return;
  const gen = generation;
  const fail = async (code: string) => {
    if (gen !== generation) return;
    stop();
    await window.meeting.call('captureError', { meetingId, epoch, code });
  };
  try {
    const streams: Array<{ stream: MediaStream; channel: string }> = [];
    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: mode === 'online',
        noiseSuppression: true,
        ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
      },
      video: false,
    });
    if (gen !== generation) {
      microphone.getTracks().forEach((t) => t.stop());
      return;
    }
    cleanup.push(() => microphone.getTracks().forEach((t) => t.stop()));
    streams.push({ stream: microphone, channel: 'microphone' });
    if (mode === 'online') {
      const system = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (gen !== generation) {
        system.getTracks().forEach((t) => t.stop());
        return;
      }
      cleanup.push(() => system.getTracks().forEach((t) => t.stop()));
      if (!system.getAudioTracks().length) throw new Error('SYSTEM_AUDIO_UNAVAILABLE');
      streams.push({ stream: system, channel: 'system_audio' });
    }
    for (const { stream, channel } of streams) {
      const ctx = new AudioContext({ sampleRate: 16000 });
      cleanup.push(() => void ctx.close());
      await ctx.audioWorklet.addModule('./pcm-worklet.js');
      if (gen !== generation) {
        await ctx.close();
        return;
      }
      const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const node = new AudioWorkletNode(ctx, 'pcm-recorder');
      source.connect(node);
      node.connect(ctx.destination);
      const captureOrigin = Date.now() - ctx.currentTime * 1000;
      let channelSequence = 0;
      let flushed: (() => void) | null = null;
      flushers.push(
        () =>
          new Promise<void>((resolve) => {
            flushed = resolve;
            node.port.postMessage('flush');
            setTimeout(resolve, 250);
          }),
      );
      node.port.onmessage = async ({
        data: packet,
      }: MessageEvent<{
        samples: Float32Array;
        final: boolean;
        startFrame: number;
        endFrame: number;
      }>) => {
        const data = packet.samples;
        const finish = packet.final ? flushed : null;
        if (packet.final) flushed = null;
        if (gen !== generation || !data.length) {
          finish?.();
          return;
        }
        const rms = Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
        if (rms < 0.0002) {
          finish?.();
          return;
        }
        const result = await window.meeting.call('audio', {
          meetingId,
          epoch,
          channel,
          wav: wav(data, ctx.sampleRate),
          segmentId: crypto.randomUUID(),
          timing: {
            captureStartMs: captureOrigin + (packet.startFrame / ctx.sampleRate) * 1000,
            captureEndMs: captureOrigin + (packet.endFrame / ctx.sampleRate) * 1000,
            channelSequence: channelSequence++,
          },
        });
        finish?.();
        if (
          !result.ok &&
          ![
            'CAPTURE_EXPIRED',
            'TRANSCRIPTION_BACKLOG',
            'TRANSCRIPTION_FAILED',
            'AGENT_BUDGET_LIMIT',
          ].includes(result.error)
        )
          await fail(result.error);
      };
      stream
        .getTracks()
        .forEach((track) => track.addEventListener('ended', () => void fail('INPUT_DISCONNECTED')));
      await ctx.resume();
    }
    if (gen !== generation) return;
    const track = microphone.getAudioTracks()[0];
    const deviceChanged = async () => {
      if (gen !== generation) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (
        deviceId &&
        deviceId !== 'default' &&
        !devices.some((d) => d.kind === 'audioinput' && d.deviceId === deviceId)
      ) {
        await fail('MICROPHONE_UNAVAILABLE');
        return;
      }
      const actual = track.getSettings();
      await window.meeting.call('captureReady', {
        meetingId,
        epoch,
        actualDevice: { deviceId: actual.deviceId ?? 'default', label: track.label },
      });
    };
    navigator.mediaDevices.addEventListener('devicechange', deviceChanged);
    cleanup.push(() => navigator.mediaDevices.removeEventListener('devicechange', deviceChanged));
    const ready = await window.meeting.call('captureReady', {
      meetingId,
      epoch,
      actualDevice: { deviceId: track.getSettings().deviceId ?? 'default', label: track.label },
    });
    if (!ready.ok) stop();
  } catch (error) {
    await fail(
      error instanceof DOMException &&
        ['NotFoundError', 'OverconstrainedError'].includes(error.name)
        ? 'MICROPHONE_UNAVAILABLE'
        : error instanceof Error && /^[A-Z_]+$/.test(error.message)
          ? error.message
          : 'INPUT_PERMISSION_OR_DEVICE',
    );
  }
});
