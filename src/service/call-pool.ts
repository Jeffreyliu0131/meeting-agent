type Lane =
  'understand' | 'personal' | 'generate' | 'transcribe' | 'translate' | 'component' | 'impact';
/** Four total calls; background lanes cannot consume understanding's reserved slot. */
export class CallPool {
  private active = new Map<Lane, number>();
  private queue: Array<{
    lane: Lane;
    signal: AbortSignal;
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
  }> = [];
  acquire(lane: Lane, signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const entry = { lane, signal, resolve, reject };
      if (signal.aborted) {
        reject(new Error('CALL_CANCELLED'));
        return;
      }
      this.queue.push(entry);
      signal.addEventListener(
        'abort',
        () => {
          const i = this.queue.indexOf(entry);
          if (i >= 0) {
            this.queue.splice(i, 1);
            reject(new Error('CALL_CANCELLED'));
          }
        },
        { once: true },
      );
      this.pump();
    });
  }
  private pump() {
    for (let i = 0; i < this.queue.length;) {
      const q = this.queue[i],
        total = [...this.active.values()].reduce((a, b) => a + b, 0),
        background = total - (this.active.get('understand') ?? 0);
      if (
        total >= 4 ||
        (this.active.get(q.lane) ?? 0) >= 1 ||
        (q.lane !== 'understand' && background >= 3)
      ) {
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      this.active.set(q.lane, (this.active.get(q.lane) ?? 0) + 1);
      let released = false;
      q.resolve(() => {
        if (released) return;
        released = true;
        this.active.set(q.lane, (this.active.get(q.lane) ?? 1) - 1);
        this.pump();
      });
    }
  }
}
