import type { Preferences } from '../contracts/model';
import { mergePreferences, type PreferencesPatch } from '../domain/preferences';

const fields = (patch: PreferencesPatch) =>
  Object.keys(patch).flatMap((key) =>
    key === 'audio' ? Object.keys(patch.audio ?? {}).map((field) => `audio.${field}`) : [key],
  );
const covers = (a: PreferencesPatch, b: PreferencesPatch) =>
  fields(b).every((key) => fields(a).includes(key));

type Job = { patch: PreferencesPatch; resolve: (ok: boolean) => void };
/** Serial writes with optimistic per-field overlays. Failed fields return to committed values. */
export class PreferenceWriter {
  private jobs: Job[] = [];
  private running = false;
  private listeners = new Set<() => void>();
  private failure: { patch: PreferencesPatch; code: string } | null = null;
  constructor(
    private confirmed: Preferences,
    private save: (patch: PreferencesPatch) => Promise<Preferences>,
  ) {}
  get value() {
    return this.jobs.reduce((value, job) => mergePreferences(value, job.patch), this.confirmed);
  }
  get busy() {
    return this.jobs.length > 0;
  }
  get error() {
    return this.failure?.code ?? '';
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  receive(preferences: Preferences) {
    this.confirmed = preferences;
    this.emit();
  }
  change(patch: PreferencesPatch): Promise<boolean> {
    if (this.failure && covers(patch, this.failure.patch)) this.failure = null;
    const promise = new Promise<boolean>((resolve) => this.jobs.push({ patch, resolve }));
    this.emit();
    void this.drain();
    return promise;
  }
  retry() {
    return this.failure ? this.change(this.failure.patch) : Promise.resolve(true);
  }
  async flush() {
    if (this.busy)
      await new Promise<void>((resolve) => {
        const off = this.subscribe(() => {
          if (!this.busy) {
            off();
            resolve();
          }
        });
      });
    return !this.failure;
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs[0];
        let ok = false;
        try {
          this.confirmed = await this.save(job.patch);
          ok = true;
        } catch (error) {
          // A newer intent for this field supersedes the failed older one.
          if (!this.jobs.slice(1).some((next) => covers(next.patch, job.patch)))
            this.failure = {
              patch: job.patch,
              code: error instanceof Error ? error.message : 'STORAGE_FAILED',
            };
        }
        this.jobs.shift();
        this.emit();
        job.resolve(ok);
      }
    } finally {
      this.running = false;
    }
  }
}
