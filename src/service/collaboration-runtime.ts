import type { Meeting, Ref } from '../contracts/model';
import type { CollaborationIntent } from '../contracts/collaboration-workflow';
import { ComponentProposal } from '../contracts/collaboration-workflow';
import type {
  CollaborationJob,
  CollaborationState,
  ComponentContent,
  ConflictRecord,
} from '../contracts/collaboration';
import {
  applyCollaborationCommand,
  saveDraft,
  addCollaborationEvent,
  publicationIssues,
  contentEvidence,
  defaultAudience,
} from '../domain/collaboration';
import {
  detectCollaborationConflicts,
  responseIssueResolved,
} from '../domain/collaboration-conflicts';
import { runComponentWorkflow, runImpactWorkflow } from '../agent/collaboration';
import { latestSegments } from '../agent/context';

function job(
  s: CollaborationState,
  kind: CollaborationJob['kind'],
  root: string,
  target: string | null,
  accepted: Ref[],
  input: unknown,
) {
  if (
    s.jobs.some(
      (j) =>
        j.rootEventId === root &&
        j.kind === kind &&
        JSON.stringify(j.input) === JSON.stringify(input),
    )
  )
    return;
  const limited = s.jobs.filter((j) => j.rootEventId === root && j.status !== 'failed').length >= 8;
  s.jobs.push({
    id: crypto.randomUUID(),
    kind,
    rootEventId: root,
    status: limited ? 'failed' : 'pending',
    ...(limited ? { error: 'ROOT_JOB_LIMIT' } : {}),
    modelCalls: 0,
    fence: 0,
    accepted,
    componentId: target,
    baseRevision: target
      ? (s.components.find((c) => c.id === target)?.draftRevision ?? null)
      : null,
    input,
  });
}
export function enqueueCollaborationIntents(
  m: Meeting,
  intents: CollaborationIntent[],
  accepted: Ref[],
  root: string,
) {
  const s = m.collaboration;
  if (!s) return;
  for (const intent of intents) {
    if (
      ['negated', 'hypothetical', 'quoted'].includes(intent.expression) ||
      intent.resolution === 'no_action'
    )
      continue;
    let target = intent.targetId;
    if (!target) {
      const candidates = s.components.filter(
        (c) =>
          c.family === intent.family &&
          c.draftState !== 'cancelled' &&
          (c.collection?.scopeText === intent.scopeText || intent.operation !== 'prepare'),
      );
      if (candidates.length === 1) target = candidates[0].id;
      else if (candidates.length > 1) {
        job(s, 'component', root, null, accepted, { ...intent, resolution: 'needs_clarification' });
        continue;
      }
    }
    job(s, 'component', root, target, accepted, intent);
  }
}
export function enqueueCollaborationImpact(
  m: Meeting,
  root: string,
  semantic: boolean,
  componentId: string | null = null,
) {
  if (m.collaboration) {
    const s = m.collaboration;
    const event = addCollaborationEvent(
      s,
      'analysis.requested',
      'system',
      componentId,
      { semantic },
      root,
    );
    for (const c of s.components)
      if (
        !componentId ||
        c.id === componentId ||
        c.family === 'assignment' ||
        c.family === 'decision_confirmation'
      )
        c.requiredAnalysisSequence = event.sequence;
    job(s, 'impact', root, componentId, [], { semantic });
  }
}

function preparePrivate(
  s: CollaborationState,
  content: ComponentContent,
  sourceRefs: any[] = [],
  collecting = false,
  scopeText = '',
) {
  const ended = s.ended;
  try {
    s.ended = false;
    return applyCollaborationCommand(s, s.participants.find((p) => p.role === 'host')!.id, {
      id: crypto.randomUUID(),
      meetingId: s.meetingId,
      type: 'component.prepare',
      payload: { content, sourceRefs, collecting: collecting && !ended, scopeText },
    }) as string;
  } finally {
    s.ended = ended;
  }
}

function analysisReadSet(m: Meeting) {
  const s = m.collaboration!;
  return JSON.stringify({
    sources: m.segments.map((r) => ({ id: r.id, rev: r.rev })),
    objects: m.objects.map((o) => ({ id: o.id, rev: o.rev })),
    components: s.components.map((c) => ({
      id: c.id,
      revision: c.draftRevision,
      published: c.publishedRevision,
      required: c.requiredAnalysisSequence,
    })),
    responses: s.responses.map((r) => ({ id: r.id, resolved: r.resolved })),
    ended: s.ended,
  });
}
type Ports = {
  read: () => Meeting;
  save: (meeting: Meeting) => void;
  generate: (input: unknown, repair?: string) => Promise<unknown>;
  analyze: (input: unknown, repair?: string) => Promise<unknown>;
  semanticAvailable?: boolean;
};
function getPath(value: any, path: string) {
  return path.split('.').reduce((v, key) => v?.[key], value);
}
function preserveLocks(content: ComponentContent, previous: ComponentContent, paths: string[]) {
  const result = structuredClone(content) as any;
  for (const path of paths) {
    const keys = path.split('.');
    if (keys.some((k) => ['__proto__', 'prototype', 'constructor'].includes(k))) continue;
    let target = result;
    for (const k of keys.slice(0, -1)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      target = target[k];
    }
    target[keys.at(-1)!] = structuredClone(getPath(previous, path));
  }
  return result as ComponentContent;
}
export class CollaborationRuntime {
  private running = false;
  get active() {
    return this.running;
  }
  constructor(private ports: Ports) {}
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.ports.read().collaboration?.jobs.some((j) => j.status === 'pending')) {
        const m = structuredClone(this.ports.read()),
          s = m.collaboration!;
        const j = s.jobs.find((j) => j.status === 'pending')!;
        j.status = 'running';
        j.fence++;
        if (j.componentId && !j.proposal)
          j.baseRevision = s.components.find((c) => c.id === j.componentId)?.draftRevision ?? null;
        this.ports.save(m);
        try {
          if (j.kind === 'component') await this.component(j);
          else await this.impact(j);
        } catch (error) {
          const latest = structuredClone(this.ports.read());
          const current = latest.collaboration!.jobs.find((job) => job.id === j.id)!;
          current.status =
            error instanceof Error && error.message === 'REVISION_CONFLICT'
              ? 'superseded'
              : 'failed';
          current.error =
            error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
              ? error.message
              : 'COLLABORATION_ANALYSIS_FAILED';
          this.ports.save(latest);
        }
      }
    } finally {
      this.running = false;
    }
  }
  private calls(j: CollaborationJob) {
    return this.ports.read().collaboration!.jobs.find((x) => x.id === j.id)!.modelCalls;
  }
  private reserve(j: CollaborationJob) {
    const m = structuredClone(this.ports.read()),
      current = m.collaboration!.jobs.find((x) => x.id === j.id)!;
    if (current.fence !== j.fence || current.modelCalls >= 2) throw Error('WORKFLOW_BUDGET_LIMIT');
    current.modelCalls++;
    this.ports.save(m);
  }
  private context(j: CollaborationJob) {
    const m = this.ports.read(),
      s = m.collaboration!;
    const intent = j.input as CollaborationIntent;
    const sourceIds = new Set([
      ...j.accepted.map((r) => r.id),
      ...(intent.sourceRefs ?? []).map((r) => r.id),
      ...m.objects.flatMap((o) => o.sources.map((r) => r.id)),
      ...m.segments
        .filter((r) => r.kind !== 'request')
        .slice(-20)
        .map((r) => r.id),
      ...(j.kind === 'impact' ? m.objects.flatMap((o) => o.sources.map((r) => r.id)) : []),
    ]);
    const sources = latestSegments(m)
      .filter((r) => r.kind !== 'request' && sourceIds.has(r.id))
      .slice(-30);
    const target = s.components.find((c) => c.id === j.componentId);
    const targetContent = target?.revisions.at(-1)?.content;
    const conflictIds =
      targetContent?.kind === 'conflict' ? targetContent.payload.conflictRefs.map((r) => r.id) : [];
    const relatedResponses = new Set(
      s.conflicts
        .filter((f) => conflictIds.includes(f.id))
        .flatMap((f) =>
          f.evidence.flatMap((e) =>
            e.kind === 'response' ? [`${e.responseId}:${e.responseVersion}`] : [],
          ),
        ),
    );
    return {
      meetingId: m.id,
      locale: m.outputLocale,
      timezone: m.timezone,
      meetingDate: m.createdAt,
      defaults: {
        audienceIds: s.participants.filter((p) => p.active && p.role !== 'host').map((p) => p.id),
        poll: {
          selection: { mode: 'single', min: 1, max: 1 },
          allowAbstain: true,
          resultsVisibility: 'after_close',
          closePolicy: { kind: 'host' },
        },
        assignment: { mode: 'request_acceptance' },
        decision_confirmation: { rule: 'all_required_explicit_agree' },
      },
      intent: j.input,
      sources,
      participants: s.participants,
      objects: m.objects
        .filter(
          (o) =>
            !o.sources.some((r) =>
              m.segments.some((seg) => seg.id === r.id && seg.kind === 'request'),
            ),
        )
        .slice(-50),
      component: j.componentId ? s.components.find((c) => c.id === j.componentId) : null,
      conflicts: s.conflicts.slice(-12),
      assignmentDirectory: s.components
        .flatMap((c) => {
          const content = c.revisions.at(-1)?.content;
          return content?.kind === 'assignment' ? content.payload.items : [];
        })
        .slice(-30),
      responses:
        j.kind === 'impact' || intent.family === 'conflict'
          ? s.responses
              .filter(
                (r) =>
                  !j.componentId ||
                  r.componentId === j.componentId ||
                  relatedResponses.has(`${r.id}:${r.version}`),
              )
              .slice(-20)
          : [],
    };
  }
  private async component(j: CollaborationJob) {
    const intent = j.input as CollaborationIntent;
    if (
      intent.resolution === 'needs_clarification' ||
      ['publish', 'close', 'cancel', 'preview'].includes(intent.operation)
    ) {
      const m = structuredClone(this.ports.read()),
        s = m.collaboration!;
      // A spoken start can finish PRIVATE preparation; only a later host command publishes.
      const target = s.components.find((c) => c.id === j.componentId);
      if (
        intent.operation === 'publish' &&
        intent.resolution !== 'needs_clarification' &&
        target?.collection?.status === 'collecting' &&
        !s.ended
      ) {
        target.collection.status = 'stopped';
        target.collection.freezeWatermark = [...j.accepted];
        target.draftState = publicationIssues(
          s,
          target,
          target.revisions.at(-1)!.content,
          target.revisions.at(-1)!.suggestedAudienceIds ??
            s.participants.filter((p) => p.role !== 'host').map((p) => p.id),
        ).length
          ? 'draft'
          : 'ready';
        target.aggregateVersion++;
      }
      addCollaborationEvent(s, 'component.suggested_action', 'agent', j.componentId, {
        operation: intent.operation,
        question:
          intent.resolution === 'needs_clarification' ? '请选择要操作的组件' : intent.scopeText,
      });
      s.jobs.find((x) => x.id === j.id)!.status = 'succeeded';
      this.ports.save(m);
      return;
    }
    const input = this.context(j);
    const result = j.proposal
      ? ComponentProposal.parse(j.proposal)
      : await runComponentWorkflow({
          remaining: () => 2 - this.calls(j),
          generate: async (repair) => {
            this.reserve(j);
            return this.ports.generate(input, repair);
          },
          validate: (proposal) => {
            if (!proposal.content) {
              if (!proposal.clarification) throw Error('INVALID_COMPONENT_PROPOSAL');
              return;
            }
            if (proposal.content.kind !== intent.family) throw Error('INVALID_COMPONENT_PROPOSAL');
            const state = structuredClone(this.ports.read().collaboration!);
            const audience = defaultAudience(state, proposal.content, proposal.audienceIds);
            if (
              new Set(audience).size !== audience.length ||
              audience.some((id) => !state.participants.some((p) => p.id === id && p.active))
            )
              throw Error('INVALID_AUDIENCE');
            if (intent.collectionMode !== 'prospective') {
              const id = preparePrivate(state, proposal.content);
              const candidate = state.components.find((c) => c.id === id)!;
              const issue = publicationIssues(state, candidate, proposal.content, audience)[0];
              if (issue) throw Error(issue);
            }
            for (const ref of contentEvidence(proposal.content)) {
              if (
                ref.kind === 'segment' &&
                !input.sources.some((s) => s.id === ref.ref.id && s.rev === ref.ref.rev)
              )
                throw Error('INVALID_COMPONENT_PROPOSAL');
              if (
                ref.kind === 'response' &&
                !input.responses.some(
                  (r) => r.id === ref.responseId && r.version === ref.responseVersion,
                )
              )
                throw Error('INVALID_COMPONENT_PROPOSAL');
              if (ref.kind === 'command') throw Error('INVALID_COMPONENT_PROPOSAL');
            }
            if (
              proposal.content.kind === 'assignment' &&
              proposal.content.payload.items.some(
                (t) => t.assigneeId && !input.participants.some((p) => p.id === t.assigneeId),
              )
            )
              throw Error('INVALID_ASSIGNEE');
          },
        });
    let m = structuredClone(this.ports.read()),
      s = m.collaboration!;
    const current = s.jobs.find((x) => x.id === j.id)!;
    if (
      current.fence !== j.fence ||
      [...j.accepted, ...intent.sourceRefs, ...input.sources].some((r) =>
        m.segments.some((source) => source.id === r.id && source.rev > r.rev),
      )
    )
      throw Error('REVISION_CONFLICT');
    const target = j.componentId ? s.components.find((c) => c.id === j.componentId) : null;
    if (target && target.draftRevision !== j.baseRevision) throw Error('REVISION_CONFLICT');
    current.proposal = result;
    this.ports.save(m);
    m = structuredClone(this.ports.read());
    s = m.collaboration!;
    let c = j.componentId ? s.components.find((c) => c.id === j.componentId) : undefined;
    if (result.content) {
      let savedRevision;
      if (!c) {
        const componentId = preparePrivate(
          s,
          result.content,
          (intent.sourceRefs ?? []).map((ref) => ({ kind: 'segment', ref })),
          intent.collectionMode === 'prospective',
          intent.scopeText,
        );
        c = s.components.find((c) => c.id === componentId)!;
        c.revisions.at(-1)!.createdBy = 'agent:' + j.id;
        savedRevision = c.revisions.at(-1)!;
      } else {
        const previous = c.revisions.at(-1)!;
        const content = preserveLocks(result.content, previous.content, previous.manualLocks);
        const refs = (intent.sourceRefs ?? []).map((ref) => ({ kind: 'segment' as const, ref }));
        if (
          JSON.stringify(content) !== JSON.stringify(previous.content) ||
          JSON.stringify(previous.sourceRefs) !== JSON.stringify(refs) ||
          JSON.stringify(previous.objectRefs) !== JSON.stringify(intent.objectRefs ?? []) ||
          JSON.stringify(previous.suggestedAudienceIds) !==
            JSON.stringify(defaultAudience(s, content, result.audienceIds))
        )
          savedRevision = saveDraft(s, c, content, 'agent:' + j.id, refs);
      }
      if (savedRevision) {
        savedRevision.objectRefs = intent.objectRefs ?? [];
        savedRevision.suggestedAudienceIds = defaultAudience(s, result.content, result.audienceIds);
      }
      if (c.collection)
        c.collection.consumedRefs = [
          ...new Map([...c.collection.consumedRefs, ...j.accepted].map((r) => [r.id, r])).values(),
        ];
      if (c.collection?.status === 'collecting' && intent.collectionMode !== 'prospective') {
        c.collection.status = 'stopped';
        c.collection.freezeWatermark = [...j.accepted];
        c.missingFields = publicationIssues(
          s,
          c,
          c.revisions.at(-1)!.content,
          defaultAudience(s, c.revisions.at(-1)!.content, c.revisions.at(-1)!.suggestedAudienceIds),
        );
        c.draftState = c.missingFields.length ? 'draft' : 'ready';
      }
      if (s.ended) {
        if (c.collection) c.collection.status = 'stopped';
        c.draftState = 'draft';
      }
      s.jobs.find((x) => x.id === j.id)!.componentId = c.id;
      if (intent.family === 'assignment' || intent.family === 'decision_confirmation')
        enqueueCollaborationImpact(m, j.rootEventId, false, c.id);
    } else
      addCollaborationEvent(s, 'component.clarification', 'agent', j.componentId, {
        question: result.clarification,
      });
    s.jobs.find((x) => x.id === j.id)!.status = 'succeeded';
    this.ports.save(m);
  }
  private async impact(j: CollaborationJob) {
    const base = structuredClone(this.ports.read());
    const sourceSequence = base.collaboration!.sequence;
    const readSet = analysisReadSet(base);
    const knownEvidence = new Set(base.collaboration!.responses.map((r) => `${r.id}:${r.version}`));
    const result = await runImpactWorkflow({
      rules: () => detectCollaborationConflicts(base.collaboration!),
      semanticNeeded: !!(j.input as any).semantic && this.ports.semanticAvailable !== false,
      remaining: () => 2 - this.calls(j),
      analyze: async (repair) => {
        this.reserve(j);
        return this.ports.analyze(this.context(j), repair);
      },
      validate: (proposal) => {
        for (const f of proposal.conflicts)
          for (const e of f.evidence)
            if (
              e.kind === 'response'
                ? !knownEvidence.has(`${e.responseId}:${e.responseVersion}`)
                : e.kind === 'segment'
                  ? !base.segments.some(
                      (r) => r.id === e.ref.id && r.rev === e.ref.rev && r.kind !== 'request',
                    )
                  : true
            )
              throw Error('INVALID_EVIDENCE');
      },
    });
    const m = structuredClone(this.ports.read()),
      s = m.collaboration!;
    // A new event makes this analysis obsolete; queued successor owns the new input.
    if (analysisReadSet(m) !== readSet) throw Error('REVISION_CONFLICT');
    const found = new Set<string>();
    for (const candidate of result) {
      const f: ConflictRecord =
        'fingerprint' in candidate
          ? candidate
          : {
              ...candidate,
              id: crypto.randomUUID(),
              revision: 1,
              fingerprint: `semantic:${candidate.type}:${candidate.objectRefs
                .map((r) => r.id)
                .sort()
                .join(':')}:${candidate.evidence.map((e) => JSON.stringify(e)).join(':')}`,
              basis: 'agent_inferred',
              verification: 'needs_confirmation',
              resolution: 'unresolved',
              coverage: 'partial',
              componentIds: j.componentId ? [j.componentId] : [],
            };
      found.add(f.fingerprint);
      const old = s.conflicts.find((old) => old.fingerprint === f.fingerprint);
      if (old) {
        f.id = old.id;
        f.revision = old.revision;
        if (JSON.stringify({ ...old, revision: 0 }) !== JSON.stringify({ ...f, revision: 0 })) {
          f.revision++;
          Object.assign(old, f);
        }
      } else s.conflicts.push(f);
      const existing = s.components.find(
        (c) => c.family === 'conflict' && c.purposeKey === f.fingerprint,
      );
      if (!existing) {
        const id = preparePrivate(
          s,
          {
            kind: 'conflict',
            payload: {
              conflictRefs: [{ id: f.id, rev: f.revision }],
              sides: [
                {
                  id: crypto.randomUUID(),
                  title: f.summary,
                  description: f.impact,
                  objectRefs: f.objectRefs,
                  evidence: f.evidence,
                },
              ],
              questions: [
                {
                  id: crypto.randomUUID(),
                  text: '请相关参与者补充可接受的调整方案。',
                  participantIds: f.affectedParticipantIds,
                },
              ],
              resolutions: [],
            },
          },
          f.evidence,
        );
        const card = s.components.find((c) => c.id === id)!;
        card.purposeKey = f.fingerprint;
        card.revisions.at(-1)!.createdBy = 'agent:' + j.id;
        if (this.ports.semanticAvailable !== false) {
          job(s, 'component', j.rootEventId, id, j.accepted, {
            family: 'conflict',
            operation: 'update',
            expression: 'suggested',
            resolution: 'actionable_draft',
            targetId: id,
            scopeText: f.summary,
            collectionMode: 'retrospective',
            sourceRefs: f.evidence.flatMap((e) => (e.kind === 'segment' ? [e.ref] : [])),
            objectRefs: f.objectRefs,
          });
        }
      } else {
        const previous = existing.revisions.at(-1)!;
        if (
          previous.content.kind === 'conflict' &&
          !previous.content.payload.conflictRefs.some(
            (ref) => ref.id === f.id && ref.rev === f.revision,
          )
        ) {
          const content = structuredClone(previous.content);
          content.payload.conflictRefs = [{ id: f.id, rev: f.revision }];
          saveDraft(s, existing, content, 'agent:' + j.id, f.evidence);
        }
      }
    }
    for (const old of s.conflicts) {
      // A rule-only pass must retain semantic findings unless all their response evidence
      // has been explicitly resolved/superseded by its original author.
      const responseEvidenceResolved =
        old.evidence.length > 0 &&
        old.evidence.every((e) => {
          if (e.kind !== 'response') return false;
          const response = s.responses.find(
            (r) => r.id === e.responseId && r.version === e.responseVersion,
          );
          return !!response && responseIssueResolved(s, response);
        });
      if (
        (old.basis !== 'agent_inferred' || responseEvidenceResolved) &&
        old.resolution !== 'resolved' &&
        !found.has(old.fingerprint)
      ) {
        old.resolution = 'resolved';
        old.revision++;
      }
    }
    for (const c of s.components) {
      c.validatedAnalysisSequence = Math.max(c.validatedAnalysisSequence, sourceSequence);
      if (
        s.jobs.some(
          (p) =>
            p.kind === 'component' &&
            p.componentId === c.id &&
            ['pending', 'running'].includes(p.status),
        )
      ) {
        if (c.draftState === 'ready') c.draftState = 'draft';
      } else if (!c.needsReview && c.draftState !== 'collecting' && c.draftState !== 'cancelled') {
        c.missingFields = publicationIssues(
          s,
          c,
          c.revisions.at(-1)!.content,
          defaultAudience(s, c.revisions.at(-1)!.content, c.revisions.at(-1)!.suggestedAudienceIds),
        );
        c.draftState = c.missingFields.length ? 'draft' : 'ready';
      }
    }
    s.jobs.find((x) => x.id === j.id)!.status = 'succeeded';
    if (JSON.stringify(base.collaboration!.conflicts) !== JSON.stringify(s.conflicts))
      addCollaborationEvent(
        s,
        'conflict.updated',
        'agent',
        j.componentId,
        { count: result.length },
        j.rootEventId,
      );
    this.ports.save(m);
  }
}
