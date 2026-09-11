/** Per-channel FIFO with bounded audio memory. Overflow is reported, never stops devices. */
export class TranscriptionQueue<T extends { bytes: number; durationMs: number }> {
  private queues = new Map<string, T[]>();
  private active = new Map<string, T>();
  private tasks = new Map<string, Promise<void>>();
  private closed = false;
  constructor(
    private process: (item: T) => Promise<void>,
    private gap: (item: T, code: string) => void,
    private changed: (pending: number) => void = () => {},
    private maxMs = 30000,
    private maxBytes = 2000000,
  ) {}
  enqueue(channel: string, item: T) {
    if (this.closed) {
      this.gap(item, 'TRANSCRIPTION_INTERRUPTED');
      return false;
    }
    const q = this.queues.get(channel) ?? [],
      inFlight = this.active.get(channel),
      all = inFlight ? [inFlight, ...q] : q;
    if (
      all.reduce((n, x) => n + x.durationMs, 0) + item.durationMs > this.maxMs ||
      all.reduce((n, x) => n + x.bytes, 0) + item.bytes > this.maxBytes
    ) {
      this.gap(item, 'TRANSCRIPTION_BACKLOG');
      return false;
    }
    q.push(item);
    this.queues.set(channel, q);
    this.changed(this.pending);
    if (!this.tasks.has(channel)) {
      const task = Promise.resolve()
        .then(() => this.run(channel))
        .finally(() => {
          this.tasks.delete(channel);
        });
      this.tasks.set(channel, task);
    }
    return true;
  }
  private async run(channel: string) {
    const q = this.queues.get(channel)!;
    while (q.length && !this.closed) {
      const item = q.shift()!;
      this.active.set(channel, item);
      try {
        await this.process(item);
      } catch {
        if (!this.closed) this.gap(item, 'TRANSCRIPTION_FAILED');
      } finally {
        this.active.delete(channel);
        this.changed(this.pending);
      }
    }
    this.queues.delete(channel);
  }
  get pending() {
    return [...this.queues.values()].reduce((n, q) => n + q.length, 0) + this.active.size;
  }
  async idle() {
    await Promise.allSettled([...this.tasks.values()]);
  }
  close() {
    this.closed = true;
    for (const item of [...this.active.values(), ...[...this.queues.values()].flat()])
      this.gap(item, 'TRANSCRIPTION_INTERRUPTED');
    this.queues.clear();
  }
}
