import WebSocket from 'ws';
import type { CallOptions } from '../agent/provider';
import { endpoint } from '../agent/provider';
import type { AudioLease } from './audio-leases';

type Callbacks = {
  run: (
    lease: AudioLease,
    seconds: () => number,
    run: (options: CallOptions) => Promise<string>,
    signal: AbortSignal,
  ) => Promise<string>;
  partial: (lease: AudioLease, text: string) => void;
  complete: (lease: AudioLease, text: string) => void;
  gap: (lease: AudioLease, code: string) => void;
  failed: (code: string) => void;
  changed: () => void;
};
type Turn = {
  lease: AudioLease;
  durationMs: number;
  silenceMs: number;
  text: string;
  committed: boolean;
  settled: boolean;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  task: Promise<void>;
  timer: ReturnType<typeof setTimeout>;
  authorized: boolean;
  controller: AbortController;
  options?: CallOptions;
  abort?: () => void;
};

/** One trusted-process connection per meeting/epoch/channel; bounded PCM is held in memory only. */
export class LiveTranscription {
  readonly ready: Promise<void>;
  private socket: WebSocket;
  private initialized = false;
  private closed = false;
  private draining = false;
  private queued: { turn: Turn; message: string }[] = [];
  private failureCode?: string;
  private current?: Turn;
  private turns = new Set<Turn>();
  private committed: Turn[] = [];
  private items = new Map<string, Turn>();
  private completedItems = new Set<string>();
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private handshakeTimer: ReturnType<typeof setTimeout>;
  private finishing?: Promise<void>;

  constructor(
    config: { key: string; base: string; model: string },
    private callbacks: Callbacks,
  ) {
    if (!config.key) throw new Error('STT_NOT_CONFIGURED');
    const url = new URL(endpoint(config.base, '/realtime'));
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('intent', 'transcription');
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    void this.ready.catch(() => {});
    this.socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${config.key}` },
      maxPayload: 1_000_000,
      handshakeTimeout: 10000,
    });
    this.handshakeTimer = setTimeout(() => this.fail('TRANSCRIPTION_TIMEOUT'), 10000);
    this.socket.on('open', () =>
      this.socket.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                transcription: { model: config.model, languages: ['en', 'zh'], delay: 'low' },
                turn_detection: null,
              },
            },
          },
        }),
      ),
    );
    this.socket.on('message', (data) => {
      try {
        this.event(JSON.parse(data.toString()));
      } catch {
        this.fail('TRANSCRIPTION_FAILED');
      }
    });
    this.socket.on('error', () => this.fail('TRANSCRIPTION_FAILED'));
    this.socket.on('close', () => {
      if (!this.closed) this.fail('TRANSCRIPTION_INTERRUPTED');
    });
  }

  get pending() {
    return this.turns.size;
  }

  append(lease: AudioLease, pcm: Uint8Array): boolean {
    if (this.closed || this.draining) return false;
    if (!pcm.byteLength || pcm.byteLength % 2 || pcm.byteLength > 48000)
      throw new Error('INVALID_AUDIO');
    if (
      this.current &&
      (this.current.lease.meetingId !== lease.meetingId ||
        this.current.lease.epoch !== lease.epoch ||
        this.current.lease.channel !== lease.channel)
    )
      throw new Error('CAPTURE_EXPIRED');
    const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let energy = 0;
    for (let i = 0; i < pcm.byteLength; i += 2) energy += (samples.getInt16(i, true) / 32768) ** 2;
    const silent = Math.sqrt(energy / (pcm.byteLength / 2)) < 0.0002;
    if (!this.current && silent) return true;
    const duration = pcm.byteLength / 48;
    if (
      [...this.turns].reduce((sum, t) => sum + t.durationMs, 0) + duration > 30000 ||
      this.socket.bufferedAmount > 2_000_000
    ) {
      this.callbacks.gap(lease, 'TRANSCRIPTION_BACKLOG');
      this.fail('TRANSCRIPTION_BACKLOG');
      return false;
    }
    const turn = this.current ?? this.newTurn(lease);
    if (!turn) return false;
    turn.durationMs += duration;
    turn.silenceMs = silent ? turn.silenceMs + duration : 0;
    turn.lease.captureEndMs = lease.captureEndMs;
    this.send(turn, {
      type: 'input_audio_buffer.append',
      audio: Buffer.from(pcm).toString('base64'),
    });
    // Frequent final segments let understanding advance even during uninterrupted speech.
    // Preserve complete source leases; provisional words never become meeting facts.
    if (turn.silenceMs >= 600 || turn.durationMs >= 2400) this.commit();
    return !this.closed;
  }

  private newTurn(lease: AudioLease): Turn | undefined {
    let resolve!: Turn['resolve'], reject!: Turn['reject'];
    const result = new Promise<string>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void result.catch(() => {});
    const turn: Turn = {
      lease: { ...lease },
      durationMs: 0,
      silenceMs: 0,
      text: '',
      committed: false,
      settled: false,
      resolve,
      reject,
      task: Promise.resolve(),
      authorized: false,
      controller: new AbortController(),
      timer: setTimeout(() => this.fail('TRANSCRIPTION_TIMEOUT'), 30000),
    };
    this.turns.add(turn);
    this.current = turn;
    turn.task = this.callbacks
      .run(
        turn.lease,
        () => turn.durationMs / 1000,
        (options) => {
          if (this.closed || turn.controller.signal.aborted)
            return Promise.reject(new Error(this.failureCode ?? 'TRANSCRIPTION_INTERRUPTED'));
          turn.authorized = true;
          turn.options = options;
          turn.abort = () => this.fail('TRANSCRIPTION_INTERRUPTED');
          if (options.signal?.aborted) turn.abort();
          else options.signal?.addEventListener('abort', turn.abort, { once: true });
          this.flushQueue();
          return result;
        },
        turn.controller.signal,
      )
      .then((text) => {
        this.callbacks.partial(turn.lease, '');
        if (text) this.callbacks.complete(turn.lease, text);
      })
      .catch((error) => {
        this.callbacks.partial(turn.lease, '');
        const code =
          this.failureCode ??
          (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : 'TRANSCRIPTION_FAILED');
        this.callbacks.gap(turn.lease, code);
        if (!this.closed) this.fail(code);
      })
      .finally(() => {
        clearTimeout(turn.timer);
        if (turn.abort) turn.options?.signal?.removeEventListener('abort', turn.abort);
        this.turns.delete(turn);
        this.callbacks.changed();
      });
    this.callbacks.changed();
    // Authorization can wait for the call pool. Retain all packets until it arrives.
    if (this.closed) return undefined;
    return turn;
  }

  private send(turn: Turn, event: unknown) {
    if (this.closed) return;
    this.queued.push({ turn, message: JSON.stringify(event) });
    this.flushQueue();
  }

  private flushQueue() {
    if (this.closed || !this.initialized) return;
    // A later authorized turn must not overtake an earlier queued turn/commit.
    while (this.queued[0]?.turn.authorized) {
      const packet = this.queued.shift()!;
      this.socket.send(packet.message);
    }
  }

  private commit() {
    const turn = this.current;
    if (!turn || turn.committed || this.closed) return;
    // Realtime requires at least 100 ms for a manually committed buffer.
    if (turn.durationMs < 100)
      this.send(turn, {
        type: 'input_audio_buffer.append',
        audio: Buffer.alloc(Math.ceil((100 - turn.durationMs) * 24) * 2).toString('base64'),
      });
    turn.committed = true;
    this.committed.push(turn);
    this.current = undefined;
    this.send(turn, { type: 'input_audio_buffer.commit' });
  }

  private event(event: any) {
    if (this.closed) return;
    if (event.type === 'session.updated') {
      if (this.initialized) return;
      this.initialized = true;
      clearTimeout(this.handshakeTimer);
      this.flushQueue();
      this.readyResolve();
      return;
    }
    if (event.type === 'error') {
      this.fail('TRANSCRIPTION_FAILED');
      return;
    }
    const id = event.item_id;
    if (typeof id !== 'string' || this.completedItems.has(id)) return;
    if (event.type === 'input_audio_buffer.committed') {
      const turn = this.committed.shift();
      if (turn) this.items.set(id, turn);
      return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      let turn = this.items.get(id);
      if (!turn) {
        turn = this.committed[0] ?? this.current;
        if (turn) this.items.set(id, turn);
      }
      if (!turn || turn.settled || typeof event.delta !== 'string') return;
      turn.text += event.delta;
      if (turn.text.length > 12000) {
        this.fail('INVALID_TRANSCRIPT');
        return;
      }
      this.callbacks.partial(turn.lease, turn.text);
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      const turn = this.items.get(id);
      if (!turn || turn.settled || !turn.committed) return;
      if (typeof event.transcript !== 'string' || event.transcript.length > 12000) {
        this.fail('INVALID_TRANSCRIPT');
        return;
      }
      turn.settled = true;
      this.items.delete(id);
      this.completedItems.add(id);
      // Only a small recent duplicate-event window is needed; finalized items cannot map to new audio.
      if (this.completedItems.size > 4096)
        this.completedItems.delete(this.completedItems.values().next().value!);
      if (event.usage?.type === 'tokens')
        turn.options?.onUsage?.(event.usage.input_tokens, event.usage.output_tokens);
      turn.resolve(event.transcript.trim());
    }
    if (event.type === 'conversation.item.input_audio_transcription.failed')
      this.fail('TRANSCRIPTION_FAILED');
  }

  finish(): Promise<void> {
    if (this.finishing) return this.finishing;
    this.draining = true;
    this.commit();
    this.finishing = Promise.allSettled([...this.turns].map((t) => t.task)).then(() =>
      this.dispose(),
    );
    return this.finishing;
  }

  close() {
    if (!this.closed) this.fail('TRANSCRIPTION_INTERRUPTED');
  }

  private fail(code: string) {
    if (this.closed) return;
    this.failureCode = code;
    this.dispose();
    for (const turn of this.turns)
      if (!turn.settled) {
        turn.settled = true;
        turn.reject(new Error(code));
        turn.controller.abort();
      }
    this.callbacks.failed(code);
  }

  private dispose() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.handshakeTimer);
    this.readyReject(new Error('TRANSCRIPTION_INTERRUPTED'));
    this.queued = [];
    this.items.clear();
    this.committed = [];
    this.current = undefined;
    this.socket.close();
  }
}
