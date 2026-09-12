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
  type ExpressionJob,
  type CallRecord,
  type Artifact,
  type Ref,
} from '../contracts/model';
import type { ModelPort, ProviderConfig } from '../agent/provider';
import type { StorePort } from './store';
import { createMeeting, reduceMeeting } from '../domain/commands';
import type { AudioLease } from '../integrations/audio-leases';
import { validateArtifact, validateDelta } from '../renderers/validate';
import { buildContextBatch, pendingSegments, latestSegments } from '../agent/context';
import { applyArtifactPatch, changedBlocks } from '../domain/artifacts';
import { validateRefs } from '../domain/evidence';
import { resolvePreferences } from '../domain/preferences';
import type { CallOptions } from '../agent/provider';
export class SessionService {
  meetings: Meeting[];
  preferences: Preferences;
  storageError: string | null = null;
  private running = new Set<string>();
  private expressing = new Map<string, Promise<void>>();
  private controllers = new Set<AbortController>();
  private closed = false;
  private liveTranscripts = new Map<string, NonNullable<Snapshot['liveTranscripts']>[number]>();
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
      m.titleMeta ??= { origin: 'user', revision: 0, sources: [] };
      m.translations ??= [];
      m.inputGaps ??= [];
      m.epoch++;
      if (m.status === 'active') m.capture = 'paused';
      m.processing = 'idle';
      // Old stores had no source watermark; replay once rather than mark an unseen correction processed.
      m.processedSources ??= {};
      m.calls ??= [];
      m.expressionJobs ??= [];
      m.expressionStatus = 'idle';
      for (const c of m.calls)
        if (c.status === 'pending') {
          c.status = 'failed';
          c.error = 'PROCESS_INTERRUPTED';
        }
    }
    this.persist();
    if (config.key)
      for (const m of this.meetings) {
        if (pendingSegments(m).length) this.schedule(m.id);
        if (m.expressionJobs?.length) void this.drainExpressions(m.id);
      }
  }
  snapshot(): Snapshot {
    return structuredClone({
      meetings: this.meetings,
      liveTranscripts: [...this.liveTranscripts.values()],
      preferences: this.preferences,
      storageError: this.storageError,
      capabilities: {
        developerInputs: process.env.MEETING_DEV_INPUTS === '1',
        modelConfigured: !!this.config.key,
        sttConfigured: !!this.config.sttKey,
        sttStreaming: this.config.sttModel === 'gpt-live-transcribe',
        sttModel: this.config.sttModel,
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
      prefs = resolvePreferences(
        c.payload as unknown as Preferences,
        process.env.MEETING_SYSTEM_LOCALE ?? Intl.DateTimeFormat().resolvedOptions().locale,
      );
    else if (c.type === 'create' || c.type === 'startMeeting') {
      const activeMeeting = meetings.find((m) => m.status === 'active');
      if (activeMeeting && c.type === 'create') throw new Error('ACTIVE_MEETING_EXISTS');
      if (c.type === 'startMeeting' && !prefs.audio?.setupCompleted)
        throw new Error('AUDIO_SETUP_REQUIRED');
      const payload =
        c.type === 'startMeeting'
          ? {
              title: '',
              titleOrigin: 'placeholder',
              mode: prefs.audio!.includeComputerAudio ? 'online' : 'microphone',
              outputLocale: prefs.defaultOutputLocale,
              timezone: c.payload.timezone,
              audioSettings: prefs.audio,
            }
          : c.payload;
      if (activeMeeting) result = activeMeeting.id;
      else {
        const m = createMeeting(payload, prefs);
        meetings.unshift(m);
        result = m.id;
      }
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
    if (c.type === 'retry' && c.meetingId) {
      const m = this.meetings.find((m) => m.id === c.meetingId)!;
      if (m.failedExpression) {
        m.expressionJobs ??= [];
        m.expressionJobs.push(m.failedExpression);
        delete m.failedExpression;
        this.persist();
        void this.drainExpressions(m.id);
        schedule = pendingSegments(m).length > 0;
      }
    }
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
  audioQueueChanged(pending: number) {
    const m = this.meetings.find((m) => m.status === 'active') ?? this.meetings[0];
    if (m) {
      m.audioPending = pending;
      this.changed();
    }
  }
  partialAudio(lease: AudioLease, text: string) {
    if (this.closed) return;
    const key = lease.meetingId + ':' + lease.segmentId;
    if (text)
      this.liveTranscripts.set(key, {
        meetingId: lease.meetingId,
        segmentId: lease.segmentId,
        channel: lease.channel,
        text,
      });
    else this.liveTranscripts.delete(key);
    this.changed();
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
    if (this.closed) return;
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
      version: m.inputVersion + 1,
      captureStartMs: lease.captureStartMs,
      captureEndMs: lease.captureEndMs,
      channelSequence: lease.channelSequence,
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
    m.segments.sort(
      (a, b) =>
        (a.captureStartMs ?? Date.parse(a.receivedAt)) -
          (b.captureStartMs ?? Date.parse(b.receivedAt)) ||
        a.channel.localeCompare(b.channel) ||
        (a.channelSequence ?? a.order) - (b.channelSequence ?? b.order),
    );
    m.segments.forEach((s, i) => {
      s.order = i + 1;
    });
    m.inputVersion++;
    m.revision++;
    this.store.save(next, this.preferences);
    this.meetings = next;
    this.changed();
    this.schedule(m.id);
  }
  schedule(id: string) {
    if (this.closed) return;
    this.dirty.add(id);
    if (this.running.has(id) || this.timers.has(id)) return;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.process(id);
      }, this.config.minBatchMs ?? 500),
    );
  }
  /** Record every attempted provider call, including failures and stale results. */
  async runCall<T>(
    id: string,
    kind: CallRecord['kind'],
    run: (options: CallOptions) => Promise<T>,
    audioSeconds?: number | (() => number),
  ): Promise<T> {
    if (this.closed) throw new Error('SERVICE_CLOSED');
    const m = this.meetings.find((m) => m.id === id);
    if (!m) throw new Error('MEETING_NOT_FOUND');
    m.calls ??= [];
    const now = Date.now(),
      window = m.calls.filter((c) => Date.parse(c.startedAt) > now - 3600000);
    const reserve = kind === 'transcribe' ? 0 : 60000 + (this.config.maxOutputTokens ?? 2500);
    const spent = window.reduce(
      (n, c) =>
        n +
        (c.inputTokens === null || c.outputTokens === null
          ? c.reservedTokens
          : c.inputTokens + c.outputTokens),
      0,
    );
    if (
      window.length >= (this.config.maxCallsPerHour ?? 2400) ||
      spent + reserve > (this.config.maxTokensPerHour ?? 4000000)
    )
      throw new Error('AGENT_BUDGET_LIMIT');
    const record: CallRecord = {
      id: crypto.randomUUID(),
      kind,
      startedAt: new Date(now).toISOString(),
      durationMs: 0,
      status: 'pending',
      inputTokens: null,
      outputTokens: null,
      reservedTokens: reserve,
      audioSeconds: typeof audioSeconds === 'number' ? audioSeconds : 0,
    };
    m.calls.push(record);
    m.calls = m.calls.filter((c) => Date.parse(c.startedAt) > now - 3600000).slice(-7200);
    m.usageTotals ??= {
      reservedTokens: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      unknownUsageCalls: 0,
      audioSeconds: 0,
    };
    m.usageTotals.calls++;
    m.usageTotals.reservedTokens += reserve;
    m.usageTotals.audioSeconds += typeof audioSeconds === 'number' ? audioSeconds : 0;
    this.persist();
    const controller = new AbortController();
    this.controllers.add(controller);
    let usage: { input: number; output: number } | undefined,
      status: CallRecord['status'] = 'failed',
      code: string | undefined;
    try {
      const value = await run({
        signal: controller.signal,
        onUsage: (input, output) => {
          usage = { input, output };
        },
      });
      status = 'ok';
      return value;
    } catch (e) {
      code =
        e instanceof Error && /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'PROVIDER_UNAVAILABLE';
      throw e;
    } finally {
      this.controllers.delete(controller);
      if (!this.closed) {
        const current = this.meetings.find((m) => m.id === id)!;
        const r = current.calls?.find((c) => c.id === record.id);
        if (r) {
          Object.assign(r, {
            durationMs: Date.now() - now,
            status,
            error: code,
            inputTokens: usage?.input ?? null,
            outputTokens: usage?.output ?? null,
          });
          const total = current.usageTotals!;
          if (typeof audioSeconds === 'function') {
            r.audioSeconds = audioSeconds();
            total.audioSeconds += r.audioSeconds;
          }
          if (usage) {
            total.inputTokens += usage.input;
            total.outputTokens += usage.output;
            total.reservedTokens -= reserve;
          } else total.unknownUsageCalls++;
          current.metrics.calls = total.calls;
          current.metrics.inputTokens = total.inputTokens;
          current.metrics.outputTokens = total.outputTokens;
          this.persist();
          this.changed();
        }
      }
    }
  }
  async process(id: string) {
    if (this.closed || this.running.has(id)) return;
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
    const began = Date.now();
    let expression: Promise<void> | undefined;
    try {
      const batch = buildContextBatch(structuredClone(start), this.config.contextBytes ?? 24000),
        snapshot = batch.meeting;
      let proposal: Proposal | undefined, repair: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await this.runCall(id, 'understand', async (options) => {
            let reported = false;
            const result = await this.model.interpret(snapshot, repair, {
              ...options,
              onUsage: (i, o) => {
                reported = true;
                options.onUsage?.(i, o);
              },
            });
            if (!reported && result.usageKnown !== false)
              options.onUsage?.(result.inputTokens, result.outputTokens);
            return result;
          });
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
          if (attempt || /MODEL_|CONTEXT_|BUDGET|fetch|timeout|INSECURE|CLOSED/i.test(code))
            throw new Error(code);
          repair = code;
        }
      }
      if (this.closed) return;
      if (!proposal) throw new Error('INVALID_PROPOSAL');
      const current = this.meetings.find((m) => m.id === id)!;
      if (
        current.languageRevision !== snapshot.languageRevision ||
        snapshot.segments.some((s) => current.segments.some((t) => t.id === s.id && t.rev > s.rev))
      ) {
        this.dirty.add(id);
        return;
      }
      const next = structuredClone(current),
        languageOnly = batch.accepted.length === 0;
      const personal = batch.accepted.some((r) =>
        snapshot.segments.some((s) => s.id === r.id && s.kind === 'request'),
      );
      const originalObjects = structuredClone(next.objects),
        originalRelations = structuredClone(next.relations);
      for (const o of languageOnly ? [] : proposal.objects) {
        const i = next.objects.findIndex((x) => x.id === o.id),
          prev = next.objects[i];
        const same = prev && JSON.stringify({ ...prev, rev: undefined }) === JSON.stringify(o);
        const value = { ...o, rev: (prev?.rev ?? 0) + (same ? 0 : 1) };
        if (i < 0) next.objects.push(value);
        else next.objects[i] = value;
      }
      for (const r of languageOnly ? [] : proposal.relations) {
        const i = next.relations.findIndex((x) => x.id === r.id),
          prev = next.relations[i];
        const same = prev && JSON.stringify({ ...prev, rev: undefined }) === JSON.stringify(r);
        const value = { ...r, rev: (prev?.rev ?? 0) + (same ? 0 : 1) };
        if (i < 0) next.relations.push(value);
        else next.relations[i] = value;
      }
      if (
        !personal &&
        proposal.titleProposal &&
        next.titleMeta?.origin !== 'user' &&
        proposal.titleProposal.baseRevision === (next.titleMeta?.revision ?? 0) &&
        (snapshot.titleMeta?.revision ?? 0) === (next.titleMeta?.revision ?? 0)
      ) {
        try {
          validateRefs(proposal.titleProposal.sources, next, true);
          if (
            proposal.titleProposal.sources.some((r) =>
              snapshot.segments.some((s) => s.id === r.id && s.kind !== 'request'),
            )
          ) {
            next.title = proposal.titleProposal.text;
            next.titleMeta = {
              origin: 'agent',
              revision: (next.titleMeta?.revision ?? 0) + 1,
              sources: proposal.titleProposal.sources,
            };
          }
        } catch {
          /* Naming never blocks understanding. */
        }
      }
      next.processedSources ??= {};
      for (const ref of batch.accepted) next.processedSources[ref.id] = ref.rev;
      next.understoodVersion = Math.max(next.understoodVersion, snapshot.inputVersion);
      if (!personal) {
        next.focus = proposal.focus;
        next.changes = proposal.changes;
      }
      next.processing = 'idle';
      next.error = null;
      next.lastUnderstandingAt = new Date().toISOString();
      next.lastContextBytes = batch.bytes;
      next.metrics.lastLatencyMs = Date.now() - began;
      if (proposal.artifact || proposal.patch || proposal.plan) {
        const refs = [
          ...(proposal.artifact?.sources ?? []),
          ...(proposal.plan?.sources ?? []),
          ...proposal.objects.flatMap((o) => o.sources),
          ...proposal.relations.flatMap((r) => r.sources),
          ...(proposal.patch?.upsertBlocks.flatMap((b) => b.sources) ?? []),
        ];
        const patchBase = proposal.patch
          ? next.artifacts.filter((a) => a.id === proposal.patch!.artifactId).at(-1)
          : undefined;
        const objectIds = new Set([
          ...(proposal.artifact?.objectIds ?? []),
          ...(proposal.plan?.objectIds ?? []),
          ...(patchBase?.objectIds ?? []),
          ...(proposal.patch?.upsertBlocks.flatMap((b) => b.objectIds) ?? []),
        ]);
        const job: ExpressionJob = {
          id: crypto.randomUUID(),
          inputVersion: snapshot.inputVersion,
          languageRevision: next.languageRevision,
          objectRefs: next.objects
            .filter((o) => objectIds.has(o.id))
            .map((o) => ({ id: o.id, rev: o.rev })),
          relationRefs: next.relations
            .filter((r) => objectIds.has(r.from) || objectIds.has(r.to))
            .map((r) => ({ id: r.id, rev: r.rev })),
          sourceRefs: [...new Map(refs.map((r) => [r.id + ':' + r.rev, r])).values()],
          artifact: proposal.artifact,
          patch: proposal.patch ?? null,
          plan: proposal.plan ?? null,
          scope: personal ? 'personal' : 'meeting',
          updateKind:
            proposal.action === 'propose_restructure'
              ? 'restructure'
              : proposal.action === 'create_artifact'
                ? 'create'
                : 'patch',
        };
        if (personal) {
          job.personalObjects = structuredClone(next.objects);
          job.personalRelations = structuredClone(next.relations);
          job.objectRefs = originalObjects
            .filter((o) => objectIds.has(o.id))
            .map((o) => ({ id: o.id, rev: o.rev }));
          job.relationRefs = originalRelations
            .filter((r) => objectIds.has(r.from) || objectIds.has(r.to))
            .map((r) => ({ id: r.id, rev: r.rev }));
        }
        next.expressionJobs ??= [];
        // Coalesce full plans for the same purpose, never discard an incremental patch's base.
        const purpose = job.plan?.purposeKey ?? job.artifact?.purposeKey;
        if (purpose && !job.patch)
          next.expressionJobs = next.expressionJobs.filter(
            (j) => (j.plan?.purposeKey ?? j.artifact?.purposeKey) !== purpose || !!j.patch,
          );
        if (next.expressionJobs.length >= 8) {
          next.expressionError = 'EXPRESSION_BACKLOG';
          next.failedExpression = job;
        } else next.expressionJobs.push(job);
      }
      if (personal) {
        next.objects = originalObjects;
        next.relations = originalRelations;
      }
      next.revision++;
      const all = this.meetings.map((m) => (m.id === id ? next : m));
      this.store.save(all, this.preferences);
      this.meetings = all;
      this.changed();
      if (pendingSegments(next).length) this.dirty.add(id);
      expression = this.drainExpressions(id);
    } catch (error) {
      if (!this.closed) {
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
      }
    } finally {
      this.running.delete(id);
      if (!this.closed) {
        const m = this.meetings.find((m) => m.id === id);
        if (m?.processing === 'working') m.processing = 'idle';
        this.changed();
        if (this.dirty.has(id)) this.schedule(id);
      }
    }
    // Callers can await this batch's expression; incoming understanding is already unlocked.
    await expression;
  }
  private dependenciesValid(job: ExpressionJob, m: Meeting) {
    return (
      job.languageRevision === m.languageRevision &&
      job.sourceRefs.every((r) => !m.segments.some((s) => s.id === r.id && s.rev > r.rev)) &&
      job.objectRefs.every((r) => m.objects.some((o) => o.id === r.id && o.rev === r.rev)) &&
      job.relationRefs.every((r) => m.relations.some((o) => o.id === r.id && o.rev === r.rev))
    );
  }
  drainExpressions(id: string): Promise<void> {
    const active = this.expressing.get(id);
    if (active) return active;
    // Defer start so the map is established before a synchronously empty queue finishes.
    const work = Promise.resolve()
      .then(async () => {
        while (!this.closed) {
          const m = this.meetings.find((m) => m.id === id),
            job = m?.expressionJobs?.[0];
          if (!m || !job) break;
          m.expressionStatus = 'working';
          this.changed();
          try {
            if (!this.dependenciesValid(job, m)) throw new Error('EXPRESSION_SUPERSEDED');
            let a: Artifact;
            if (job.patch) {
              const base = m.artifacts.filter((a) => a.id === job.patch!.artifactId).at(-1);
              if (!base) throw new Error('ARTIFACT_NOT_FOUND');
              a = applyArtifactPatch(base, job.patch);
            } else if (job.artifact) a = structuredClone(job.artifact);
            else {
              if (!job.plan || !this.model.generate) throw new Error('GENERATOR_UNAVAILABLE');
              const context = structuredClone(m);
              context.objects = job.personalObjects ?? context.objects;
              context.relations = job.personalRelations ?? context.relations;
              context.objects = context.objects.filter(
                (o) =>
                  job.objectRefs.some((r) => r.id === o.id) || job.plan?.objectIds.includes(o.id),
              );
              context.relations = context.relations.filter(
                (r) =>
                  job.relationRefs.some((ref) => ref.id === r.id) ||
                  context.objects.some((o) => o.id === r.from || o.id === r.to),
              );
              const refs = [
                ...job.sourceRefs,
                ...context.objects.flatMap((o) => o.sources),
                ...context.relations.flatMap((r) => r.sources),
              ];
              context.segments = latestSegments(context).filter((s) =>
                refs.some((r) => r.id === s.id && r.rev === s.rev),
              );
              context.artifacts = [];
              let generated: Artifact | undefined;
              let repair: string | undefined;
              for (let attempt = 0; attempt < 2; attempt++) {
                try {
                  const result = await this.runCall(id, 'generate', async (options) => {
                    let reported = false;
                    const result = await this.model.generate!(context, job.plan!, repair, {
                      ...options,
                      onUsage: (i, o) => {
                        reported = true;
                        options.onUsage?.(i, o);
                      },
                    });
                    if (!reported && result.usageKnown !== false)
                      options.onUsage?.(result.inputTokens, result.outputTokens);
                    return result;
                  });
                  generated = validateArtifact(
                    result.artifact,
                    context,
                    context.objects,
                    context.relations,
                  );
                  break;
                } catch (e) {
                  if (
                    attempt ||
                    (e instanceof Error && /MODEL_|BUDGET|CONTEXT|CLOSED/.test(e.message))
                  )
                    throw e;
                  repair = e instanceof Error ? e.message : 'INVALID_ARTIFACT';
                }
              }
              if (!generated) throw new Error('INVALID_ARTIFACT');
              a = generated;
            }
            const current = this.meetings.find((m) => m.id === id)!;
            a = validateArtifact(
              a,
              current,
              job.personalObjects ?? current.objects,
              job.personalRelations ?? current.relations,
            );
            await this.preview(a);
            if (this.closed) break;
            const fresh = this.meetings.find((m) => m.id === id)!;
            if (!this.dependenciesValid(job, fresh)) throw new Error('EXPRESSION_SUPERSEDED');
            if (
              job.patch &&
              fresh.artifacts.filter((a) => a.id === job.patch!.artifactId).at(-1)?.rev !==
                job.patch.baseRev
            )
              throw new Error('ARTIFACT_CONFLICT');
            const next = structuredClone(fresh);
            const same = next.artifacts
              .filter((v) => v.purposeKey === a.purposeKey && (v.scope ?? 'meeting') === job.scope)
              .at(-1);
            if (same) a.id = same.id;
            else if (
              next.artifacts.some((v) => v.id === a.id && (v.scope ?? 'meeting') !== job.scope)
            )
              a.id = crypto.randomUUID();
            const previous = next.artifacts.filter((v) => v.id === a.id).at(-1);
            next.artifacts.push({
              ...a,
              rev: (previous?.rev ?? 0) + 1,
              generation: job.inputVersion,
              inputVersion: job.inputVersion,
              locale: next.outputLocale,
              languageRevision: job.languageRevision,
              objectRefs: a.objectIds
                .filter((id) => next.objects.some((o) => o.id === id))
                .map((id) => ({ id, rev: next.objects.find((o) => o.id === id)!.rev })),
              relationRefs: job.relationRefs,
              elementSources: Object.fromEntries([
                ...(job.personalObjects ?? next.objects).map((o) => [o.id, o.sources]),
                ...(job.personalRelations ?? next.relations).map((r) => [r.id, r.sources]),
              ]),
              changedBlockIds: changedBlocks(previous, a),
              updateKind: job.updateKind,
              scope: job.scope,
              createdAt: new Date().toISOString(),
            });
            next.lastExpressionAt = new Date().toISOString();
            next.expressionError = null;
            next.error = next.error === 'INVALID_ARTIFACT' ? null : next.error;
            next.expressionJobs = next.expressionJobs?.filter((j) => j.id !== job.id);
            next.expressionStatus = 'idle';
            next.revision++;
            this.store.save(
              this.meetings.map((m) => (m.id === id ? next : m)),
              this.preferences,
            );
            this.meetings = this.meetings.map((m) => (m.id === id ? next : m));
            this.changed();
          } catch (e) {
            if (this.closed) break;
            const next = this.meetings.find((m) => m.id === id)!;
            const superseded = e instanceof Error && e.message === 'EXPRESSION_SUPERSEDED';
            next.expressionJobs = next.expressionJobs?.filter((j) => j.id !== job.id);
            if (!superseded) {
              next.expressionStatus = 'error';
              next.expressionError =
                e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'INVALID_ARTIFACT';
              next.error = 'INVALID_ARTIFACT';
              next.failedExpression = job;
            } else next.expressionStatus = 'idle';
            try {
              this.persist();
            } catch {
              this.storageError = 'STORAGE_FAILED';
            }
            this.changed();
          }
        }
      })
      .finally(() => {
        this.expressing.delete(id);
      });
    this.expressing.set(id, work);
    return work;
  }
  async flush() {
    while (!this.closed && (this.running.size || this.timers.size || this.expressing.size)) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  close() {
    this.closed = true;
    for (const c of this.controllers) c.abort();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.store.close();
  }
}
