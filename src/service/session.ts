import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  Command,
  Locale,
  Proposal,
  type Meeting,
  type Preferences,
  type Snapshot,
  type ObjectState,
  type RelationState,
} from '../contracts/model';
import type { ModelPort, ProviderConfig } from '../agent/provider';
import type { StorePort } from './store';
import { createMeeting, reduceMeeting } from '../domain/commands';
import type { AudioLease } from '../integrations/audio-leases';
import { validateArtifact, validateDelta } from '../renderers/validate';
export class SessionService {
  meetings: Meeting[];
  preferences: Preferences;
  storageError: string | null = null;
  private running = new Set<string>();
  private dirty = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    readonly store: StorePort,
    readonly model: ModelPort,
    readonly config: ProviderConfig,
    readonly changed: () => void = () => {},
    readonly preview: (
      artifact: import('../contracts/model').Artifact,
    ) => Promise<void> = async () => {},
  ) {
    const state = store.load();
    this.meetings = state.meetings;
    this.preferences = state.preferences;
    // Reopening a process restores saved content, never devices.
    for (const m of this.meetings) {
      m.translations ??= [];
      m.inputGaps ??= [];
      m.epoch++;
      if (m.status === 'active') m.capture = 'paused';
      m.processing = 'idle';
    }
    this.persist();
    if (config.key)
      for (const m of this.meetings) if (m.inputVersion > m.understoodVersion) this.schedule(m.id);
  }
  snapshot(): Snapshot {
    return structuredClone({
      meetings: this.meetings,
      preferences: this.preferences,
      storageError: this.storageError,
      capabilities: {
        modelConfigured: !!this.config.key,
        sttConfigured: !!this.config.sttKey,
        model: this.config.model,
        modelHost: new URL(this.config.base).host,
        sttHost: new URL(this.config.sttBase).host,
        platform: process.platform,
      },
    });
  }
  private persist() {
    try {
      this.store.save(this.meetings, this.preferences);
      this.storageError = null;
    } catch {
      this.storageError = 'STORAGE_FAILED';
      throw new Error('STORAGE_FAILED');
    }
  }
  command(raw: unknown) {
    const c = Command.parse(raw);
    const hash = createHash('sha256').update(JSON.stringify(c)).digest('hex');
    const old = this.store.command(c.id);
    if (old) {
      if (old.hash !== hash) throw new Error('IDEMPOTENCY_CONFLICT');
      return old.result;
    }
    const meetings = structuredClone(this.meetings);
    let prefs = structuredClone(this.preferences);
    let result: unknown = null,
      schedule = false;
    if (c.type === 'preferences')
      prefs = z
        .object({
          uiLocale: Locale,
          defaultOutputLocale: Locale,
          reduceMotion: z.boolean(),
          reduceTransparency: z.boolean(),
          shortcut: z.string().max(100),
        })
        .strict()
        .parse(c.payload);
    else if (c.type === 'create') {
      if (meetings.some((m) => m.status === 'active')) throw new Error('ACTIVE_MEETING_EXISTS');
      const m = createMeeting(c.payload, prefs);
      meetings.unshift(m);
      result = m.id;
    } else {
      const m = meetings.find((m) => m.id === c.meetingId);
      if (!m) throw new Error('MEETING_NOT_FOUND');
      ({ result, schedule } = reduceMeeting(m, c));
    }
    try {
      this.store.save(meetings, prefs, { id: c.id, hash, result });
      this.storageError = null;
    } catch {
      this.storageError = 'STORAGE_FAILED';
      this.changed();
      throw new Error('STORAGE_FAILED');
    }
    this.meetings = meetings;
    this.preferences = prefs;
    this.changed();
    if (schedule && c.meetingId) this.schedule(c.meetingId);
    return result;
  }
  saveTranslation(meetingId: string, translation: import('../contracts/model').Translation) {
    const meetings = structuredClone(this.meetings);
    const m = meetings.find((m) => m.id === meetingId);
    if (!m) throw new Error('MEETING_NOT_FOUND');
    if (m.segments.some((s) => s.id === translation.segmentId && s.rev > translation.sourceRev))
      throw new Error('SOURCE_SUPERSEDED');
    m.translations.push(translation);
    m.revision++;
    this.store.save(meetings, this.preferences);
    this.meetings = meetings;
    this.changed();
    return translation;
  }
  recordInputGap(lease: AudioLease, code: string) {
    const meetings = structuredClone(this.meetings),
      m = meetings.find((m) => m.id === lease.meetingId);
    if (!m) return;
    m.inputGaps.push({
      epoch: lease.epoch,
      channel: lease.channel,
      receivedAt: lease.receivedAt,
      code,
    });
    m.captureError = code;
    m.revision++;
    this.store.save(meetings, this.preferences);
    this.meetings = meetings;
    this.changed();
  }
  completeAudio(lease: AudioLease, text: string) {
    const next = structuredClone(this.meetings);
    const m = next.find((m) => m.id === lease.meetingId);
    if (!m) throw new Error('MEETING_NOT_FOUND');
    if (!text.trim() || text.length > 12000) throw new Error('INVALID_TRANSCRIPT');
    const existing = m.segments.find((s) => s.id === lease.segmentId);
    if (existing) {
      if (existing.text !== text) throw new Error('IDEMPOTENCY_CONFLICT');
      return;
    }
    m.segments.push({
      id: lease.segmentId,
      rev: 1,
      text,
      kind: lease.channel,
      epoch: lease.epoch,
      channel: lease.channel,
      order: m.segments.length + 1,
      receivedAt: lease.receivedAt,
      speaker: null,
      identity: 'unknown',
      identityBasis: null,
      synthetic: false,
    });
    m.inputVersion++;
    m.revision++;
    this.store.save(next, this.preferences);
    this.meetings = next;
    this.changed();
    this.schedule(m.id);
  }
  schedule(id: string) {
    this.dirty.add(id);
    if (this.running.has(id) || this.timers.has(id)) return;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.process(id);
      }, 500),
    );
  }
  async process(id: string) {
    if (this.running.has(id)) return;
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.dirty.delete(id);
    const start = this.meetings.find((m) => m.id === id);
    if (!start || !start.segments.length) return;
    this.running.add(id);
    start.processing = 'working';
    this.changed();
    const snapshot = structuredClone(start),
      began = Date.now();
    let committed = false;
    try {
      let proposal: Proposal | undefined;
      let repair: string | undefined;
      let inputTokens = 0,
        outputTokens = 0,
        calls = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await this.model.interpret(snapshot, repair);
          calls++;
          inputTokens += result.inputTokens;
          outputTokens += result.outputTokens;
          proposal = Proposal.parse(result.proposal);
          validateDelta(proposal, snapshot);
          break;
        } catch (error) {
          const code =
            error instanceof z.ZodError
              ? 'INVALID_PROPOSAL'
              : error instanceof Error
                ? error.message
                : 'MODEL_UNAVAILABLE';
          if (attempt || /MODEL_|CONTEXT_|fetch|timeout|INSECURE/i.test(code))
            throw new Error(code);
          repair = code;
        }
      }
      if (!proposal) throw new Error('INVALID_PROPOSAL');
      let renderError = false;
      if (proposal.artifact) {
        try {
          const projectedObjects = [...snapshot.objects];
          for (const object of proposal.objects) {
            const at = projectedObjects.findIndex((o) => o.id === object.id);
            if (at < 0) projectedObjects.push({ ...object, rev: 1 });
            else projectedObjects[at] = { ...object, rev: projectedObjects[at].rev + 1 };
          }
          const projectedRelations = [...snapshot.relations];
          for (const relation of proposal.relations) {
            const at = projectedRelations.findIndex((r) => r.id === relation.id);
            if (at < 0) projectedRelations.push({ ...relation, rev: 1 });
            else projectedRelations[at] = { ...relation, rev: projectedRelations[at].rev + 1 };
          }
          const candidate = validateArtifact(
            structuredClone(proposal.artifact),
            snapshot,
            projectedObjects,
            projectedRelations,
          );
          await this.preview(candidate);
        } catch {
          renderError = true;
        }
      }
      const current = this.meetings.find((m) => m.id === id)!;
      if (
        current.languageRevision !== snapshot.languageRevision ||
        snapshot.segments
          .filter((s) => !snapshot.segments.some((t) => t.id === s.id && t.rev > s.rev))
          .some(
            (s) =>
              !current.segments.some((t) => t.id === s.id && t.rev === s.rev) ||
              current.segments.some((t) => t.id === s.id && t.rev > s.rev),
          )
      ) {
        this.dirty.add(id);
        return;
      }
      const next = structuredClone(current);
      const languageOnly = snapshot.inputVersion === snapshot.understoodVersion;
      const objects: ObjectState[] = [...next.objects];
      for (const o of languageOnly ? [] : proposal.objects) {
        const at = objects.findIndex((x) => x.id === o.id),
          prev = objects[at];
        const value = { ...o, rev: (prev?.rev || 0) + 1 };
        if (at < 0) objects.push(value);
        else objects[at] = value;
      }
      const relations: RelationState[] = [...next.relations];
      for (const r of languageOnly ? [] : proposal.relations) {
        const at = relations.findIndex((x) => x.id === r.id),
          prev = relations[at];
        const value = { ...r, rev: (prev?.rev || 0) + 1 };
        if (at < 0) relations.push(value);
        else relations[at] = value;
      }
      next.objects = objects;
      next.relations = relations;
      next.focus = proposal.focus;
      next.changes = proposal.changes;
      next.understoodVersion = snapshot.inputVersion;
      next.metrics = {
        calls: next.metrics.calls + calls,
        inputTokens: next.metrics.inputTokens + inputTokens,
        outputTokens: next.metrics.outputTokens + outputTokens,
        lastLatencyMs: Date.now() - began,
      };
      // Understanding and artifact validity have separate failure boundaries.
      next.processing = 'idle';
      next.error = null;
      if (proposal.artifact) {
        try {
          if (renderError) throw new Error('RENDER_FAILED');
          const a = validateArtifact(structuredClone(proposal.artifact), next, objects, relations);
          const samePurpose = next.artifacts.filter((v) => v.purposeKey === a.purposeKey).at(-1);
          if (samePurpose) a.id = samePurpose.id;
          const previous = next.artifacts.filter((v) => v.id === a.id).at(-1);
          next.artifacts.push({
            ...a,
            rev: (previous?.rev || 0) + 1,
            generation: snapshot.inputVersion,
            locale: next.outputLocale,
            languageRevision: next.languageRevision,
            inputVersion: snapshot.inputVersion,
            elementSources: Object.fromEntries([
              ...objects.map((o) => [o.id, o.sources]),
              ...relations.map((r) => [r.id, r.sources]),
            ]),
            objectRefs: a.objectIds.map((id) => ({
              id,
              rev: objects.find((o) => o.id === id)!.rev,
            })),
            createdAt: new Date().toISOString(),
          });
        } catch {
          next.error = 'INVALID_ARTIFACT';
          next.processing = 'error';
        }
      }
      next.revision++;
      const all = this.meetings.map((m) => (m.id === id ? next : m));
      this.store.save(all, this.preferences);
      this.meetings = all;
      committed = true;
    } catch (error) {
      const m = this.meetings.find((m) => m.id === id);
      if (m) {
        m.processing = 'error';
        const code = error instanceof Error ? error.message : '';
        m.error = /^[A-Z0-9_]+$/.test(code) ? code : 'MODEL_UNAVAILABLE';
        try {
          this.persist();
        } catch {
          this.storageError = 'STORAGE_FAILED';
        }
      }
    } finally {
      this.running.delete(id);
      const m = this.meetings.find((m) => m.id === id);
      if (m && !committed && m.processing === 'working') m.processing = 'idle';
      this.changed();
      if (this.dirty.has(id)) this.schedule(id);
    }
  }
  close() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.store.close();
  }
}
