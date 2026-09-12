import { MeetingCandidate, type ReminderView } from '../contracts/meeting-candidate';

export const BUBBLE_DURATION_MS = 8000;
export const CANDIDATE_MAX_AGE_MS = 120000;
type Context = {
  enabled: boolean;
  launcherVisible: boolean;
  available: boolean;
  active?: { id: string; capture: string };
};
type StartResult = { meetingId: string | null; state: string; reason?: string };
type Ports = {
  context: () => Context;
  present: (view: ReminderView | null) => void;
  start: (stillValid: () => boolean) => Promise<StartResult>;
  recover: (reason?: string) => void;
  now?: () => number;
};

/** Owns consent, freshness and one-shot delivery, independently of every window. */
export class MeetingReminder {
  private episodes = new Map<string, { signal: MeetingCandidate; consumed: boolean }>();
  private view: ReminderView | null = null;
  private expiry?: ReturnType<typeof setTimeout>;
  private dismissal?: ReturnType<typeof setTimeout>;
  private remaining = BUBBLE_DURATION_MS;
  private resumedAt = 0;
  private held = false;
  private meetingId: string | null = null;
  private now: () => number;
  constructor(private ports: Ports) {
    this.now = ports.now ?? Date.now;
  }
  get current() {
    return this.view ? { ...this.view } : null;
  }
  receive(raw: unknown): boolean {
    const parsed = MeetingCandidate.safeParse(raw);
    if (!parsed.success) return false;
    const signal = parsed.data;
    const previous = this.episodes.get(signal.id);
    if (previous && signal.revision <= previous.signal.revision) return false;
    if (signal.expiresAt > this.now() + CANDIDATE_MAX_AGE_MS) return false;
    // Bound memory without evicting deduplication records and re-alerting the same episode.
    if (!previous && this.episodes.size >= 1024) return false;
    const episode = { signal, consumed: previous?.consumed ?? false };
    this.episodes.set(signal.id, episode);
    if (!signal.present || signal.expiresAt <= this.now()) {
      episode.consumed = true;
      if (this.view?.id === signal.id && this.view.phase === 'prompt') this.clear();
      return false;
    }
    if (this.view?.id === signal.id && this.view.phase === 'prompt') {
      this.armExpiry(signal);
      return true;
    }
    if (episode.consumed) return false;
    // A rejected offer is not queued for later surprise delivery.
    episode.consumed = true;
    const ctx = this.ports.context();
    if (!ctx.enabled || !ctx.available || ctx.active || this.view) return false;
    this.remaining = BUBBLE_DURATION_MS;
    this.held = false;
    this.view = {
      id: signal.id,
      channel: ctx.launcherVisible ? 'bubble' : 'system',
      phase: 'prompt',
    };
    this.ports.present(this.current);
    this.armExpiry(signal);
    this.resumeDismissal();
    return true;
  }
  private armExpiry(signal: MeetingCandidate) {
    clearTimeout(this.expiry);
    this.expiry = setTimeout(
      () => this.dismiss(signal.id),
      Math.max(0, signal.expiresAt - this.now()),
    );
  }
  hold(id: string, held: boolean) {
    if (
      this.view?.id !== id ||
      this.view.channel !== 'bubble' ||
      this.view.phase !== 'prompt' ||
      this.held === held
    )
      return;
    this.held = held;
    if (held) {
      this.remaining = Math.max(0, this.remaining - (this.now() - this.resumedAt));
      clearTimeout(this.dismissal);
    } else this.resumeDismissal();
  }
  private resumeDismissal() {
    if (this.view?.channel !== 'bubble' || this.view.phase !== 'prompt') return;
    this.resumedAt = this.now();
    this.dismissal = setTimeout(() => this.clear(), this.remaining);
  }
  dismiss(id: string) {
    if (this.view?.id === id && this.view.phase === 'prompt') this.clear();
  }
  private valid(id: string) {
    const signal = this.episodes.get(id)?.signal;
    const ctx = this.ports.context();
    return (
      !!signal?.present &&
      signal.expiresAt > this.now() &&
      ctx.enabled &&
      ctx.available &&
      !ctx.active
    );
  }
  async accept(id: string): Promise<boolean> {
    if (this.view?.id !== id || this.view.phase !== 'prompt') return false;
    if (!this.valid(id)) {
      this.clear();
      return false;
    }
    clearTimeout(this.expiry);
    clearTimeout(this.dismissal);
    this.view = { ...this.view, phase: 'starting' };
    this.ports.present(this.current);
    try {
      const result = await this.ports.start(() => this.valid(id));
      if (this.view?.id !== id) return false;
      if (result.state === 'stale') {
        this.clear();
        return false;
      }
      if (result.state === 'needs_setup' || result.state === 'input_error') {
        this.clear();
        this.ports.recover(result.reason);
        return true;
      }
      if (!result.meetingId || !['starting', 'capturing'].includes(result.state)) {
        this.clear();
        return false;
      }
      this.meetingId = result.meetingId;
      this.synchronize();
      return true;
    } catch (error) {
      this.clear();
      this.ports.recover(error instanceof Error ? error.message : 'INVALID_REQUEST');
      return false;
    }
  }
  synchronize() {
    if (!this.view) return;
    const ctx = this.ports.context();
    if (this.view.phase === 'prompt') {
      // Never move an already-delivered reminder between channels.
      if (!this.valid(this.view.id) || ctx.launcherVisible !== (this.view.channel === 'bubble'))
        this.clear();
      return;
    }
    if (!ctx.available) {
      this.clear();
      return;
    }
    // Hiding the launcher dismisses feedback but never cancels a consented start.
    if (!ctx.launcherVisible && this.view.channel === 'bubble') {
      this.view = { ...this.view, channel: 'system' };
      this.ports.present(this.current);
    }
    if (!this.meetingId) return; // The accepted start is still resolving.
    if (ctx.active?.id !== this.meetingId) {
      this.clear();
      return;
    }
    if (['input_error', 'paused', 'stopped'].includes(ctx.active.capture)) {
      const failed = ctx.active.capture === 'input_error';
      this.clear();
      if (failed) this.ports.recover();
    } else if (ctx.active.capture === 'capturing' && this.view.phase !== 'recording') {
      this.view = { ...this.view, phase: 'recording' };
      this.ports.present(this.current);
      this.dismissal = setTimeout(() => this.clear(), 1600);
    }
  }
  clear() {
    clearTimeout(this.expiry);
    clearTimeout(this.dismissal);
    this.view = null;
    this.meetingId = null;
    this.held = false;
    this.ports.present(null);
  }
}
