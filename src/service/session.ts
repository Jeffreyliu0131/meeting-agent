import {
  applyCollaboration,
  validateCollaboration,
  refreshCollaboration,
} from '../domain/intent-preparation';
import { CallPool } from './call-pool';
import { validatePresentationRepair } from '../domain/expression-repair';
import { RenderFailure } from '../contracts/render-report';
import { runWorkflow } from '../agent/workflow';
import { executeEvidence } from '../agent/tools';
import {
  digest,
  readSet,
  readsValid,
  assertLease,
  resolveNewRefs,
  expressionIdentity,
  makeWorkflowJob,
  addEvidenceRead,
  type WorkflowJob,
} from './workflow-state';
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
import {
  buildContextBatch,
  pendingSegments,
  latestSegments,
  scopedContext,
} from '../agent/context';
import { commitMeaning, refreshIntegrity, dependencies } from '../domain/meaning';
import { reconcileCloseout } from '../domain/closeout';
import { applyArtifactPatch, changedBlocks } from '../domain/artifacts';
import { validateRefs } from '../domain/evidence';
import { resolvePreferences } from '../domain/preferences';
import type { CallOptions } from '../agent/provider';
export class SessionService {
  meetings: Meeting[];
  preferences: Preferences;
  storageError: string | null = null;
  private pool = new CallPool();
  private requestControllers = new Map<string, AbortController>();
  private running = new Set<string>();
  private expressing = new Map<string, Promise<void>>();
  private controllers = new Set<AbortController>();
  private closed = false;
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
    readonly evidence: (
      ...args: Parameters<typeof executeEvidence>
    ) => Promise<ReturnType<typeof executeEvidence>> = async (...args) => executeEvidence(...args),
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
      // Legacy stores have relations but no dependency snapshots. Establish the
      // observed baseline before source repairs so failures still propagate review.
      for (const o of m.objects)
        o.dependencyRefs ??= dependencies(m, o.id).map((id) => ({
          id,
          rev: m.objects.find((x) => x.id === id)?.rev ?? 0,
        }));
      m.workflowJobs ??= [];
      for (const job of m.workflowJobs)
        if (['running', 'proposed'].includes(job.status)) {
          job.fence++;
          job.leaseUntil = 0;
          job.status = job.proposal ? 'proposed' : 'pending';
        }
      m.calls ??= [];
      m.expressionJobs ??= [];
      m.expressionStatus = 'idle';
      if ((m.audioPending ?? 0) > 0)
        m.inputGaps.push({
          epoch: m.epoch,
          channel: 'unknown',
          receivedAt: new Date().toISOString(),
          code: 'PROCESS_INTERRUPTED',
        });
      m.audioPending = 0;
      if (!config.key && pendingSegments(m).length) {
        m.processing = 'error';
        m.error = 'MODEL_NOT_CONFIGURED';
      }
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
      preferences: this.preferences,
      storageError: this.storageError,
      capabilities: {
        developerInputs: process.env.MEETING_DEV_INPUTS === '1',
        modelConfigured: !!this.config.key,
        sttConfigured: !!this.config.sttKey,
        model: this.config.model,
        modelHost: new URL(this.config.base).host,
        sttHost: new URL(this.config.sttBase).host,
        platform: process.platform,
      },
    });
  }
  private saveState(...args: Parameters<StorePort['save']>) {
    for (const m of args[0]) {
      for (const c of m.clarifications ?? [])
        if (
          c.status === 'pending' &&
          c.candidates.some((r) => !m.objects.some((o) => o.id === r.id && o.rev === r.rev))
        )
          c.status = 'stale';
      refreshIntegrity(m);
      m.closeout = reconcileCloseout(m);
    }
    try {
      this.store.save(...args);
    } catch (cause) {
      this.storageError = 'STORAGE_FAILED';
      throw new Error('STORAGE_FAILED', { cause });
    }
  }
  private persist() {
    try {
      this.saveState(this.meetings, this.preferences);
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
    if ((c.type === 'ask' || c.type === 'answerClarification') && result) {
      const m = meetings.find((m) => m.id === c.meetingId)!;
      const request = result as Meeting['segments'][number];
      const input = structuredClone(m);
      input.segments = input.segments.filter((s) => s.kind !== 'request' || s.id === request.id);
      input.artifacts = input.artifacts.filter(
        (a) => (a.scope ?? 'meeting') === 'meeting' || a.id === request.requestContext?.artifactId,
      );
      input.processedSources = Object.fromEntries(
        input.segments.filter((s) => s.id !== request.id).map((s) => [s.id, s.rev]),
      );
      const batch = buildContextBatch(
        input,
        Math.min(this.config.contextBytes ?? 24000, this.model.maxContextBytes ?? Infinity),
      );
      m.workflowJobs ??= [];
      m.workflowJobs.push(makeWorkflowJob(batch.meeting, batch.accepted, request.id));
    }
    try {
      this.saveState(meetings, prefs, { id: c.id, hash, result });
      this.storageError = null;
    } catch {
      this.storageError = 'STORAGE_FAILED';
      this.changed();
      throw new Error('STORAGE_FAILED');
    }
    this.meetings = meetings;
    if (c.type === 'cancelRequest')
      this.requestControllers.get(String(c.payload.requestId))?.abort();
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
    this.saveState(meetings, this.preferences);
    this.meetings = meetings;
    this.changed();
    return translation;
  }
  audioQueueChanged(pending: number, meetingId?: string) {
    const m = meetingId
      ? this.meetings.find((m) => m.id === meetingId)
      : (this.meetings.find((m) => m.status === 'active') ?? this.meetings[0]);
    if (m) {
      m.audioPending = pending;
      this.persist();
      this.changed();
    }
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
    this.saveState(meetings, this.preferences);
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
    this.saveState(next, this.preferences);
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
    audioSeconds?: number,
    requestId?: string,
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
      audioSeconds,
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
    m.usageTotals.audioSeconds += audioSeconds ?? 0;
    this.persist();
    const controller = new AbortController();
    this.controllers.add(controller);
    if (requestId) this.requestControllers.set(requestId, controller);
    let release: (() => void) | undefined;
    let usage: { input: number; output: number } | undefined,
      status: CallRecord['status'] = 'failed',
      code: string | undefined;
    try {
      release = await this.pool.acquire(kind, controller.signal);
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
      release?.();
      if (requestId) this.requestControllers.delete(requestId);
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
    const m = this.meetings.find((m) => m.id === id);
    if (!m || this.closed) return;
    const requests = pendingSegments(m).filter((s) => s.kind === 'request');
    await Promise.all([
      this.processBatch(id),
      ...requests.slice(0, 3).map((s) => this.processBatch(id, s.id)),
    ]);
  }
  private async processBatch(id: string, requestId?: string) {
    const lock = requestId ? id + ':' + requestId : id;
    if (this.closed || this.running.has(lock)) return;
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.dirty.delete(id);
    const start = this.meetings.find((m) => m.id === id);
    if (!start || !start.segments.length) return;
    this.running.add(lock);
    if (!requestId) start.processing = 'working';
    this.changed();
    const began = Date.now();
    let expression: Promise<void> | undefined;
    let jobId: string | undefined;
    let fence = 0;
    try {
      const input = structuredClone(start);
      input.segments = input.segments.filter((s) =>
        requestId ? s.kind !== 'request' || s.id === requestId : s.kind !== 'request',
      );
      if (requestId)
        input.processedSources = Object.fromEntries(
          input.segments.filter((s) => s.id !== requestId).map((s) => [s.id, s.rev]),
        );
      if (
        !pendingSegments(input).length &&
        (!input.segments.length ||
          requestId ||
          input.languageRevision === (input.understoodLanguageRevision ?? 0))
      )
        return;
      const recover = start.workflowJobs?.find(
        (j) =>
          j.requestId === requestId &&
          ['pending', 'proposed', 'failed'].includes(j.status) &&
          !/^(CONTEXT_|REQUEST_CONTEXT)/.test(j.error ?? '') &&
          (j.proposal || j.modelCalls < (requestId ? 4 : 2)) &&
          j.accepted.every((r) => input.segments.some((s) => s.id === r.id && s.rev === r.rev)),
      );
      const batch = recover
        ? {
            meeting: structuredClone(recover.context),
            accepted: recover.accepted,
            pending: 0,
            bytes: Buffer.byteLength(JSON.stringify(recover.context)),
          }
        : buildContextBatch(
            input,
            Math.min(this.config.contextBytes ?? 24000, this.model.maxContextBytes ?? Infinity),
          );
      const personal = !!requestId;
      const hash =
        recover?.hash ??
        digest({
          accepted: batch.accepted,
          language: input.languageRevision,
          scope: personal ? 'personal' : 'meeting',
          requestId,
        });
      const live = this.meetings.find((m) => m.id === id)!;
      live.workflowJobs ??= [];
      let job = live.workflowJobs.find(
        (j) => j.hash === hash && !['superseded', 'cancelled', 'rejected'].includes(j.status),
      );
      if (job?.status === 'succeeded') return;
      if (!job) {
        const context = structuredClone(batch.meeting);
        delete context.workflowJobs;
        context.calls = [];
        context.expressionJobs = [];
        job = {
          id: crypto.randomUUID(),
          hash,
          scope: personal ? 'personal' : 'meeting',
          requestId,
          accepted: batch.accepted,
          context,
          readSet: readSet(context),
          status: 'pending',
          fence: 0,
          leaseUntil: 0,
          attempts: Math.max(
            0,
            ...live.workflowJobs.filter((j) => j.hash === hash).map((j) => j.attempts),
          ),
          modelCalls: Math.max(
            0,
            ...live.workflowJobs.filter((j) => j.hash === hash).map((j) => j.modelCalls),
          ),
          toolCalls: Math.max(
            0,
            ...live.workflowJobs.filter((j) => j.hash === hash).map((j) => j.toolCalls),
          ),
          observations: [],
          createdAt: new Date().toISOString(),
        };
        live.workflowJobs.push(job);
      }
      jobId = job.id;
      job.fence++;
      fence = job.fence;
      job.leaseUntil = Date.now() + 300000;
      job.attempts++;
      job.status = job.proposal ? 'proposed' : 'running';
      this.persist();
      const currentJob = () =>
        this.meetings.find((m) => m.id === id)!.workflowJobs!.find((j) => j.id === jobId)!;
      const snapshot = structuredClone(job.context);
      const limit = personal ? 4 : 2;
      let proposal = job.proposal;
      if (!proposal)
        proposal = await runWorkflow(
          {
            context: snapshot,
            remaining: () => limit - currentJob().modelCalls,
            interpret: async (repair) => {
              const j = currentJob();
              assertLease(j, fence);
              if (j.modelCalls >= limit) throw new Error('WORKFLOW_BUDGET_LIMIT');
              j.modelCalls++;
              this.persist();
              const result = await this.runCall(
                id,
                personal ? 'personal' : 'understand',
                (options) => this.model.interpret(snapshot, repair, options),
                undefined,
                requestId,
              );
              assertLease(currentJob(), fence);
              return result.proposal;
            },
            validate: (p) => {
              validateDelta(p, snapshot);
              validateCollaboration(p, snapshot);
            },
            evidence: async (request) => {
              const j = currentJob();
              assertLease(j, fence);
              if (j.toolCalls >= (personal ? 6 : 1)) throw new Error('TOOL_BUDGET_LIMIT');
              j.toolCalls++;
              this.persist();
              const observed = structuredClone(this.meetings.find((m) => m.id === id)!);
              let observation: ReturnType<typeof executeEvidence>;
              try {
                const remaining = 12000 - Buffer.byteLength(JSON.stringify(j.observations));
                if (remaining < 512) throw new Error('EVIDENCE_BUDGET_LIMIT');
                observation = await this.evidence(request, observed, j.scope, requestId, remaining);
              } catch (error) {
                observation = {
                  resultId: crypto.randomUUID(),
                  inputHash: digest(request),
                  kind: request.kind,
                  values: [],
                  refs: [],
                  coverage: { total: 0, loaded: 0, hasMore: false, cursor: null },
                  status: 'error',
                  error:
                    error instanceof Error && /^[A-Z_]+$/.test(error.message)
                      ? error.message
                      : 'TOOL_FAILED',
                };
              }
              assertLease(currentJob(), fence);
              const updated = currentJob();
              updated.observations.push(observation);
              for (const ref of observation.refs) addEvidenceRead(updated.readSet, ref, observed);
              snapshot.toolObservations = structuredClone(updated.observations);
              // Expose retrieved source/object versions to the same validators as initial context.
              for (let i = 0; i < observation.refs.length; i++) {
                const ref = observation.refs[i],
                  value = observation.values[i];
                if (
                  ref.kind === 'source' &&
                  !snapshot.segments.some((s) => s.id === ref.id && s.rev === ref.rev)
                )
                  snapshot.segments.push(value as Meeting['segments'][number]);
                if (
                  ref.kind === 'object' &&
                  observed.objects.some((o) => o.id === ref.id && o.rev === ref.rev) &&
                  !snapshot.objects.some((o) => o.id === ref.id && o.rev === ref.rev)
                )
                  snapshot.objects.push(value as ObjectState);
              }
              updated.context = structuredClone(snapshot);
              this.persist();
            },
          },
          personal,
        );
      if (!job.proposal) {
        const j = currentJob();
        assertLease(j, fence);
        const authority = this.meetings.find((m) => m.id === id)!;
        if (
          !personal &&
          [...proposal.objects, ...proposal.relations].some(
            (o) =>
              [...authority.objects, ...authority.relations].some((x) => x.id === o.id) &&
              ![...snapshot.objects, ...snapshot.relations].some((x) => x.id === o.id),
          )
        )
          throw new Error('UNREAD_OBJECT_WRITE');
        const resolved = resolveNewRefs(proposal, snapshot);
        proposal = resolved.proposal;
        j.idMap = resolved.idMap;
        j.proposal = structuredClone(proposal);
        j.proposalHash = digest(proposal);
        j.status = 'proposed';
        this.persist();
      }
      if (this.closed) return;
      if (!proposal) throw new Error('INVALID_PROPOSAL');
      const current = this.meetings.find((m) => m.id === id)!;
      const committingJob = current.workflowJobs!.find((j) => j.id === jobId)!;
      assertLease(committingJob, fence);
      if (digest(proposal) !== committingJob.proposalHash) throw new Error('PROPOSAL_MUTATED');
      if (!personal && !readsValid(committingJob.readSet, current)) {
        committingJob.status = 'superseded';
        this.dirty.add(id);
        return;
      }
      if (
        !personal &&
        (proposal.objects.some(
          (o) =>
            current.objects.some((x) => x.id === o.id) &&
            !committingJob.readSet.objects.some((r) => r.id === o.id),
        ) ||
          proposal.relations.some(
            (o) =>
              current.relations.some((x) => x.id === o.id) &&
              !committingJob.readSet.relations.some((r) => r.id === o.id),
          ))
      )
        throw new Error('UNREAD_OBJECT_WRITE');
      const next = structuredClone(current),
        languageOnly = batch.accepted.length === 0;
      const originalHistory = structuredClone(next.objectHistory ?? []);
      const originalObjects = structuredClone(next.objects),
        originalRelations = structuredClone(next.relations);
      validateDelta(proposal, personal ? snapshot : scopedContext(current, 'meeting'));
      validateCollaboration(proposal, personal ? snapshot : scopedContext(current, 'meeting'));
      if (!languageOnly) commitMeaning(next, proposal);
      if (!personal) validateCollaboration({ ...proposal, objects: [] }, next);
      if (!personal && !languageOnly) applyCollaboration(next, proposal, batch.accepted, jobId!);
      refreshCollaboration(next);
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
      next.clarifications ??= [];
      if (proposal.action === 'request_clarification') {
        const c = proposal.clarification;
        if (!c || !committingJob.observations.length)
          throw new Error('CLARIFICATION_REQUIRES_SEARCH');
        validateRefs(c.sources, next, true);
        if (c.candidates.some((r) => !next.objects.some((o) => o.id === r.id && o.rev === r.rev)))
          throw new Error('CLARIFICATION_CANDIDATE_STALE');
        const key = digest([
          requestId ?? 'meeting',
          c.question.trim().replace(/\s+/g, ' ').toLowerCase(),
          [...c.candidates].sort((a, b) => a.id.localeCompare(b.id)),
          [...c.affectedObjectIds].sort(),
        ]);
        if (!next.clarifications.some((q) => q.key === key))
          next.clarifications.push({
            ...c,
            id: crypto.randomUUID(),
            key,
            status: 'pending',
            resolutionSources: [],
            branchId: requestId,
          });
      }
      if (proposal.resolvesClarification && !personal) {
        const resolution = proposal.resolvesClarification;
        const c = next.clarifications.find(
          (c) => c.id === resolution.id && !c.branchId && c.status === 'pending',
        );
        validateRefs(resolution.sources, next, true);
        if (
          !c ||
          !resolution.sources.some((r) =>
            batch.accepted.some((a) => a.id === r.id && a.rev === r.rev),
          )
        )
          throw new Error('CLARIFICATION_RESOLUTION_EVIDENCE');
        c.status = 'resolved';
        c.resolutionSources = resolution.sources;
      }
      next.processedSources ??= {};
      for (const ref of batch.accepted) next.processedSources[ref.id] = ref.rev;
      next.understoodVersion = Math.max(next.understoodVersion, snapshot.inputVersion);
      if (!personal) {
        next.focus = proposal.focus;
        next.changes = proposal.changes;
      }
      if (!personal) {
        next.understoodLanguageRevision = snapshot.languageRevision;
        next.processing = 'idle';
        next.error = null;
      }
      next.lastUnderstandingAt = new Date().toISOString();
      next.lastContextBytes = batch.bytes;
      if (!personal) next.contextCoverage = snapshot.contextIndex?.coverage;
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
        for (const id of objectIds)
          for (const dependency of dependencies(next, id)) objectIds.add(dependency);
        const job: ExpressionJob = {
          id: crypto.randomUUID(),
          workflowJobId: jobId,
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
          branchId: requestId,
          updateKind:
            proposal.action === 'propose_restructure'
              ? 'restructure'
              : proposal.action === 'create_artifact'
                ? 'create'
                : 'patch',
        };
        if (personal) {
          job.personalContext = structuredClone(snapshot);
          job.personalObjects = structuredClone(next.objects);
          job.personalRelations = structuredClone(next.relations);
          job.objectRefs = snapshot.objects
            .filter((o) => objectIds.has(o.id))
            .map((o) => ({ id: o.id, rev: o.rev }));
          job.relationRefs = snapshot.relations
            .filter((r) => objectIds.has(r.from) || objectIds.has(r.to))
            .map((r) => ({ id: r.id, rev: r.rev }));
        }
        next.expressionJobs ??= [];
        // Coalesce full plans for the same purpose, never discard an incremental patch's base.
        const purpose = job.plan?.purposeKey ?? job.artifact?.purposeKey;
        if (purpose && !job.patch)
          next.expressionJobs = next.expressionJobs.filter(
            (j) => expressionIdentity(j) !== expressionIdentity(job) || !!j.patch,
          );
        if (next.expressionJobs.length >= 8) {
          next.expressionError = 'EXPRESSION_BACKLOG';
          next.failedExpression = job;
        } else next.expressionJobs.push(job);
      }
      if (personal) {
        next.objects = originalObjects;
        next.relations = originalRelations;
        next.objectHistory = originalHistory;
      }
      next.revision++;
      const all = this.meetings.map((m) => (m.id === id ? next : m));
      const completed = next.workflowJobs!.find((j) => j.id === jobId)!;
      completed.status = 'succeeded';
      if (proposal.artifact || proposal.plan || proposal.patch)
        completed.expressionState = next.expressionJobs?.some((j) => j.workflowJobId === jobId)
          ? 'queued'
          : 'failed';
      completed.leaseUntil = 0;
      this.saveState(all, this.preferences, {
        id: 'workflow_' + jobId,
        hash: completed.proposalHash!,
        result: { jobId, accepted: completed.accepted, idMap: completed.idMap },
      });
      this.meetings = all;
      this.changed();
      if (pendingSegments(next).length) this.dirty.add(id);
      expression = this.drainExpressions(id);
    } catch (error) {
      if (!this.closed) {
        const m = this.meetings.find((m) => m.id === id);
        if (m) {
          if (!requestId) m.processing = 'error';
          if (
            !jobId &&
            error instanceof Error &&
            /^(CONTEXT_|REQUEST_CONTEXT)/.test(error.message)
          ) {
            const source = pendingSegments(m).find((s) =>
              requestId ? s.id === requestId : s.kind !== 'request',
            );
            if (source) {
              m.workflowJobs ??= [];
              let oversized = m.workflowJobs.find(
                (j) =>
                  j.error === error.message &&
                  j.accepted.some((r) => r.id === source.id && r.rev === source.rev),
              );
              if (!oversized) {
                const context = scopedContext(m, requestId ? 'personal' : 'meeting');
                context.segments = [source];
                context.objects = [];
                context.relations = [];
                context.artifacts = [];
                oversized = makeWorkflowJob(
                  context,
                  [{ id: source.id, rev: source.rev }],
                  requestId,
                );
                m.workflowJobs.push(oversized);
              }
              oversized.status = 'failed';
              oversized.error = error.message;
              oversized.attempts++;
              if (oversized.attempts >= 2) {
                m.quarantinedSources ??= {};
                m.quarantinedSources[source.id] = source.rev;
                if (pendingSegments(m).length) this.dirty.add(id);
              }
            }
          }
          const failed = m.workflowJobs?.find((j) => j.id === jobId);
          if (failed && failed.status !== 'cancelled') {
            const rejected =
              !!failed.proposal && !(error instanceof Error && error.message === 'STORAGE_FAILED');
            failed.status = rejected ? 'rejected' : 'failed';
            failed.error = error instanceof Error ? error.message : 'WORKFLOW_FAILED';
            if (rejected || (!failed.proposal && failed.modelCalls >= (requestId ? 4 : 2))) {
              m.quarantinedSources ??= {};
              for (const r of failed.accepted) m.quarantinedSources[r.id] = r.rev;
              if (pendingSegments(m).length) this.dirty.add(id);
            }
          }
          const code = error instanceof Error ? error.message : '';
          if (!requestId) m.error = /^[A-Z0-9_]+$/.test(code) ? code : 'MODEL_UNAVAILABLE';
          try {
            this.persist();
          } catch {
            this.storageError = 'STORAGE_FAILED';
          }
        }
      }
    } finally {
      this.running.delete(lock);
      if (!this.closed) {
        const m = this.meetings.find((m) => m.id === id);
        if (!requestId && m?.processing === 'working') m.processing = 'idle';
        try {
          this.persist();
        } catch {
          this.storageError = 'STORAGE_FAILED';
        }
        this.changed();
        if (this.dirty.has(id)) this.schedule(id);
      }
    }
    // Callers can await this batch's expression; incoming understanding is already unlocked.
    await expression;
  }
  private dependenciesValid(job: ExpressionJob, m: Meeting) {
    if (job.scope === 'personal')
      return !m.workflowJobs?.some(
        (j) => j.requestId === job.branchId && (j.status === 'cancelled' || j.cancelled),
      );
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
          const owner = m.workflowJobs?.find((j) => j.id === job.workflowJobId);
          if (owner) owner.expressionState = 'running';
          this.changed();
          try {
            if (!this.dependenciesValid(job, m)) throw new Error('EXPRESSION_SUPERSEDED');
            let a: Artifact;
            let previewed = false;
            if (job.candidate) a = structuredClone(job.candidate);
            else if (job.patch) {
              const base = m.artifacts.filter((a) => a.id === job.patch!.artifactId).at(-1);
              if (!base) throw new Error('ARTIFACT_NOT_FOUND');
              a = applyArtifactPatch(base, job.patch);
            } else if (job.artifact) a = structuredClone(job.artifact);
            else {
              if (!job.plan || !this.model.generate) throw new Error('GENERATOR_UNAVAILABLE');
              const context = job.personalContext
                ? structuredClone(job.personalContext)
                : scopedContext(m, job.scope);
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
              let repairBaseline: Artifact | undefined;
              let repair: string | undefined;
              for (let attempt = 0; attempt < 2; attempt++) {
                try {
                  const budgetJob = this.meetings
                    .find((m) => m.id === id)!
                    .expressionJobs!.find((j) => j.id === job.id)!;
                  if ((budgetJob.modelCalls ?? 0) >= 2) throw new Error('EXPRESSION_BUDGET_LIMIT');
                  budgetJob.modelCalls = (budgetJob.modelCalls ?? 0) + 1;
                  this.persist();
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
                  if (repairBaseline) validatePresentationRepair(repairBaseline, generated);
                  repairBaseline = structuredClone(generated);
                  const stored = this.meetings
                    .find((m) => m.id === id)!
                    .expressionJobs!.find((j) => j.id === job.id);
                  if (!stored) throw new Error('EXPRESSION_SUPERSEDED');
                  stored.candidate = structuredClone(generated);
                  this.persist();
                  await this.preview(generated);
                  previewed = true;
                  break;
                } catch (e) {
                  if (
                    attempt ||
                    (e instanceof Error && /MODEL_|BUDGET|CONTEXT|CLOSED/.test(e.message))
                  )
                    throw e;
                  repair =
                    e instanceof RenderFailure
                      ? JSON.stringify({
                          renderReport: e.report,
                          allowedChanges:
                            'layout and carrier only; preserve facts, sources, object IDs and formula values',
                          previous: generated,
                        })
                      : e instanceof Error
                        ? e.message
                        : 'INVALID_ARTIFACT';
                }
              }
              if (!generated) throw new Error('INVALID_ARTIFACT');
              a = generated;
            }
            const current = this.meetings.find((m) => m.id === id)!;
            a = validateArtifact(
              a,
              job.personalContext ?? scopedContext(current, job.scope),
              job.personalObjects ?? current.objects,
              job.personalRelations ?? current.relations,
            );
            if (!previewed) {
              try {
                await this.preview(a);
              } catch (error) {
                if (!this.model.generate) throw error;
                const pending = this.meetings
                  .find((m) => m.id === id)!
                  .expressionJobs!.find((j) => j.id === job.id)!;
                if (!pending) throw new Error('EXPRESSION_SUPERSEDED');
                if ((pending.modelCalls ?? 0) >= (job.plan ? 2 : 1))
                  throw new Error('EXPRESSION_BUDGET_LIMIT');
                pending.modelCalls = (pending.modelCalls ?? 0) + 1;
                this.persist();
                const before = structuredClone(a);
                const report =
                  error instanceof RenderFailure
                    ? error.report
                    : {
                        ok: false,
                        issues: [
                          {
                            blockId: null,
                            errorCode: error instanceof Error ? error.message : 'RENDER_FAILED',
                          },
                        ],
                      };
                const result = await this.runCall(id, 'generate', (options) =>
                  this.model.generate!(
                    job.personalContext ?? scopedContext(current, job.scope),
                    {
                      purposeKey: a.purposeKey,
                      question: a.question,
                      instruction:
                        'Repair presentation only. Preserve content, IDs, sources and formulas.',
                      objectIds: a.objectIds,
                      sources: a.sources,
                    },
                    JSON.stringify({ renderReport: report, previous: before }),
                    options,
                  ),
                );
                a = validateArtifact(
                  result.artifact,
                  job.personalContext ?? scopedContext(current, job.scope),
                  job.personalObjects ?? current.objects,
                  job.personalRelations ?? current.relations,
                );
                validatePresentationRepair(before, a);
                const repaired = this.meetings
                  .find((m) => m.id === id)!
                  .expressionJobs!.find((j) => j.id === job.id);
                if (!repaired) throw new Error('EXPRESSION_SUPERSEDED');
                repaired.candidate = structuredClone(a);
                this.persist();
                await this.preview(a);
              }
            }
            if (this.closed) break;
            const fresh = this.meetings.find((m) => m.id === id)!;
            if (
              !fresh.expressionJobs?.some((j) => j.id === job.id) ||
              !this.dependenciesValid(job, fresh)
            )
              throw new Error('EXPRESSION_SUPERSEDED');
            if (
              job.patch &&
              fresh.artifacts.filter((a) => a.id === job.patch!.artifactId).at(-1)?.rev !==
                job.patch.baseRev
            )
              throw new Error('ARTIFACT_CONFLICT');
            const next = structuredClone(fresh);
            const same = next.artifacts
              .filter(
                (v) =>
                  v.purposeKey === a.purposeKey &&
                  (v.scope ?? 'meeting') === job.scope &&
                  v.branchId === job.branchId &&
                  JSON.stringify(v.objectIds) === JSON.stringify(a.objectIds),
              )
              .at(-1);
            if (same) a.id = same.id;
            else if (next.artifacts.some((v) => v.id === a.id)) a.id = crypto.randomUUID();
            const previous = next.artifacts.filter((v) => v.id === a.id).at(-1);
            next.artifacts.push({
              ...a,
              rev: (previous?.rev ?? 0) + 1,
              generation: job.inputVersion,
              inputVersion: job.inputVersion,
              locale: job.personalContext?.outputLocale ?? next.outputLocale,
              languageRevision: job.languageRevision,
              objectRefs:
                job.scope === 'personal'
                  ? job.objectRefs
                  : a.objectIds
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
              branchId: job.branchId,
              createdAt: new Date().toISOString(),
            });
            const completedOwner = next.workflowJobs?.find((j) => j.id === job.workflowJobId);
            if (completedOwner) completedOwner.expressionState = 'succeeded';
            next.lastExpressionAt = new Date().toISOString();
            next.expressionError = null;
            next.error = next.error === 'INVALID_ARTIFACT' ? null : next.error;
            next.expressionJobs = next.expressionJobs?.filter((j) => j.id !== job.id);
            next.expressionStatus = 'idle';
            next.revision++;
            this.saveState(
              this.meetings.map((m) => (m.id === id ? next : m)),
              this.preferences,
            );
            this.meetings = this.meetings.map((m) => (m.id === id ? next : m));
            this.changed();
          } catch (e) {
            if (this.closed) break;
            const next = this.meetings.find((m) => m.id === id)!;
            const superseded = e instanceof Error && e.message === 'EXPRESSION_SUPERSEDED';
            const failedOwner = next.workflowJobs?.find((j) => j.id === job.workflowJobId);
            if (failedOwner && !failedOwner.cancelled) {
              failedOwner.expressionState = 'failed';
              failedOwner.expressionError = e instanceof Error ? e.message : 'EXPRESSION_FAILED';
            }
            const failedJob = next.expressionJobs?.find((j) => j.id === job.id) ?? job;
            next.expressionJobs = next.expressionJobs?.filter((j) => j.id !== job.id);
            if (!superseded) {
              next.expressionStatus = 'error';
              next.expressionError =
                e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'INVALID_ARTIFACT';
              next.error = 'INVALID_ARTIFACT';
              next.failedExpression = failedJob;
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
    if (this.closed) return;
    this.closed = true;
    for (const c of this.controllers) c.abort();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.store.close();
  }
}
