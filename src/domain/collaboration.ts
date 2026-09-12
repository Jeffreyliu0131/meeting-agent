import { z } from 'zod';
import {
  CollaborationCommand,
  ComponentContent,
  ComponentResponse,
  EvidenceRef,
  Family,
  emptyContent,
  type CollaborationState,
  type Component,
  type ComponentRevision,
  type PublishedRound,
  type ResponseRecord,
  type CollaborationSnapshot,
} from '../contracts/collaboration';

const id = z.string().min(1).max(100);
const revision = z.number().int().positive();
const now = () => new Date().toISOString();
function fail(code: string): never {
  throw new Error(code);
}
export function createCollaboration(meetingId: string, names: string[]): CollaborationState {
  z.array(z.string().trim().min(1).max(80)).min(1).max(9).parse(names);
  return {
    schemaVersion: 1,
    meetingId,
    ended: false,
    sequence: 0,
    participants: ['发起者', ...names].map((displayName, i) => ({
      id: crypto.randomUUID(),
      meetingId,
      displayName,
      role: i ? 'participant' : 'host',
      identityBasis: 'local_simulation',
      active: true,
    })),
    components: [],
    responses: [],
    conflicts: [],
    events: [],
    jobs: [],
    receipts: [],
    decisions: [],
    processedSources: {},
    ignoredPurposes: [],
  };
}
export function addCollaborationEvent(
  s: CollaborationState,
  type: string,
  actorId: string,
  componentId: string | null,
  payload: unknown,
  rootEventId?: string,
) {
  const event = {
    id: crypto.randomUUID(),
    sequence: ++s.sequence,
    type,
    componentId,
    actorId,
    at: now(),
    payload,
    rootEventId: rootEventId ?? crypto.randomUUID(),
  };
  s.events.push(event);
  return event;
}
export function currentResponses(s: CollaborationState, c: Component, round: PublishedRound) {
  const heads = new Map<string, ResponseRecord>();
  for (const r of s.responses)
    if (r.componentId === c.id && r.publishedRevision === round.revision)
      heads.set(r.actorId + ':' + r.subject, r);
  return [...heads.values()];
}
export function findRound(c: Component) {
  return c.rounds.find((r) => r.revision === c.publishedRevision) ?? null;
}
export function contentEvidence(content: ComponentContent): EvidenceRef[] {
  if (content.kind === 'conflict') return content.payload.sides.flatMap((side) => side.evidence);
  if (content.kind === 'assignment')
    return content.payload.items.flatMap((item) =>
      item.discussionPoints.flatMap((point) => point.sourceRefs),
    );
  if (content.kind === 'decision_confirmation')
    return [
      ...content.payload.conditions.flatMap((condition) => condition.evidence),
      ...content.payload.supportingResults.map((ref) => ({
        kind: 'component_result' as const,
        ...ref,
      })),
    ];
  return [];
}
export function pollResult(round: PublishedRound, records: ResponseRecord[]) {
  if (round.content.kind !== 'poll') return null;
  const votes = records.filter((r) => r.response.kind === 'vote');
  const counts = round.content.payload.options.map((o) => {
    const count = votes.filter(
      (r) => r.response.kind === 'vote' && r.response.optionIds.includes(o.id),
    ).length;
    return {
      optionId: o.id,
      count,
      percentOfVoters: votes.length ? (count * 100) / votes.length : null,
    };
  });
  const max = Math.max(0, ...counts.map((c) => c.count));
  const leaders = max ? counts.filter((c) => c.count === max).map((c) => c.optionId) : [];
  return {
    eligible: round.audienceIds.length,
    voted: votes.length,
    abstained: records.filter((r) => r.response.kind === 'abstain').length,
    pending: round.audienceIds.length - records.length,
    counts,
    leadingOptionIds: leaders,
    tied: leaders.length > 1,
    final: round.status !== 'open',
  };
}
export function publicationIssues(
  s: CollaborationState,
  c: Component,
  content: ComponentContent,
  audience: string[],
  time = Date.now(),
): string[] {
  const issues: string[] = [];
  if (
    !audience.length ||
    audience.length > 10 ||
    new Set(audience).size !== audience.length ||
    audience.some((a) => !s.participants.some((p) => p.id === a && p.active))
  )
    issues.push('INVALID_AUDIENCE');
  if (c.requiredAnalysisSequence > c.validatedAnalysisSequence) issues.push('ANALYSIS_INCOMPLETE');
  if (c.needsReview) issues.push('DEPENDENCY_STALE');
  if (content.kind === 'poll') {
    const p = content.payload;
    if (!p.question.trim() || p.options.length < 2 || p.options.some((o) => !o.label.trim()))
      issues.push('MISSING_REQUIRED_FIELDS');
    if (
      new Set(p.options.map((o) => o.id)).size !== p.options.length ||
      new Set(p.options.map((o) => o.label.trim().toLocaleLowerCase())).size !== p.options.length
    )
      issues.push('DUPLICATE_OPTIONS');
    if (
      p.selection.min > p.selection.max ||
      p.selection.max > p.options.length ||
      (p.selection.mode === 'single' && (p.selection.min !== 1 || p.selection.max !== 1))
    )
      issues.push('INVALID_SELECTION');
    if (p.closePolicy.kind === 'deadline' && Date.parse(p.closePolicy.at) <= time)
      issues.push('INVALID_DEADLINE');
  } else if (content.kind === 'assignment') {
    if (!content.payload.items.length) issues.push('MISSING_REQUIRED_FIELDS');
    if (new Set(content.payload.items.map((i) => i.id)).size !== content.payload.items.length)
      issues.push('DUPLICATE_ITEMS');
    for (const item of content.payload.items) {
      if (!item.title.trim() || !item.deliverable.trim()) issues.push('MISSING_REQUIRED_FIELDS');
      if (item.assigneeId && !s.participants.some((p) => p.id === item.assigneeId))
        issues.push('INVALID_ASSIGNEE');
      if (
        content.payload.mode === 'request_acceptance' &&
        (!item.assigneeId || !audience.includes(item.assigneeId))
      )
        issues.push('ASSIGNEE_REQUIRED');
      const t = item.schedule;
      if (
        (t.start === null) !== (t.end === null) ||
        (t.start && t.end && Date.parse(t.start) >= Date.parse(t.end))
      )
        issues.push('INVALID_SCHEDULE');
      if (t.timezone) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: t.timezone });
        } catch {
          issues.push('INVALID_TIMEZONE');
        }
      }
      if (t.precision === 'interval' && (!t.start || !t.end || !t.timezone))
        issues.push('INVALID_SCHEDULE');
    }
    if (
      content.payload.mode === 'request_acceptance' &&
      s.conflicts.some(
        (f) =>
          f.componentIds.includes(c.id) &&
          f.scope !== 'published' &&
          f.basis === 'rule' &&
          f.verification === 'supported' &&
          f.resolution !== 'resolved',
      )
    )
      issues.push('UNRESOLVED_CONFLICT');
  } else if (content.kind === 'conflict') {
    if (!content.payload.conflictRefs.length || !content.payload.sides.length)
      issues.push('MISSING_REQUIRED_FIELDS');
    if (
      content.payload.conflictRefs.some(
        (r) => !s.conflicts.some((f) => f.id === r.id && f.revision === r.rev),
      )
    )
      issues.push('CONFLICT_NOT_FOUND');
  } else {
    const p = content.payload;
    if (!p.statement.trim() || !p.scopeText.trim()) issues.push('MISSING_REQUIRED_FIELDS');
    if (
      p.requiredParticipantIds.length &&
      (p.requiredParticipantIds.length !== audience.length ||
        p.requiredParticipantIds.some((a) => !audience.includes(a)))
    )
      issues.push('INVALID_AUDIENCE');
    if (
      p.supportingResults.some(
        (ref) =>
          !s.components.some(
            (x) =>
              x.id === ref.componentId &&
              x.rounds.some((r) => r.revision === ref.publishedRevision && r.status === 'closed'),
          ),
      )
    )
      issues.push('RESULT_NOT_FINAL');
  }
  return [...new Set(issues)];
}
function changedPaths(a: unknown, b: unknown, prefix = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  )
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) =>
      changedPaths((a as any)[k], (b as any)[k], prefix ? prefix + '.' + k : k),
    );
  return [prefix];
}
export function saveDraft(
  s: CollaborationState,
  c: Component,
  content: ComponentContent,
  actorId: string,
  sourceRefs: EvidenceRef[] = [],
  manual = false,
) {
  const parsed = ComponentContent.parse(content);
  if (parsed.kind !== c.family || JSON.stringify(parsed).length > 32768) fail('INVALID_COMPONENT');
  const old = c.revisions.at(-1);
  if (parsed.kind === 'assignment' && old?.content.kind === 'assignment') {
    const previousItems = old.content.payload.items;
    for (const item of parsed.payload.items) {
      const previous = previousItems.find((p) => p.id === item.id);
      if (previous)
        item.itemRevision =
          previous.itemRevision +
          (JSON.stringify({ ...item, itemRevision: 0 }) ===
          JSON.stringify({ ...previous, itemRevision: 0 })
            ? 0
            : 1);
    }
  }
  const next: ComponentRevision = {
    revision: (old?.revision ?? 0) + 1,
    content: parsed,
    sourceRefs,
    objectRefs: old?.objectRefs ?? [],
    manualLocks: [
      ...new Set([
        ...(old?.manualLocks ?? []),
        ...(manual && old ? changedPaths(old.content, parsed) : []),
      ]),
    ],
    createdAt: now(),
    createdBy: actorId,
  };
  c.revisions.push(next);
  c.draftRevision = next.revision;
  c.draftState = c.collection?.status === 'collecting' ? 'collecting' : 'draft';
  if (
    c.draftState !== 'collecting' &&
    !publicationIssues(
      s,
      c,
      parsed,
      s.participants.filter((p) => p.role !== 'host').map((p) => p.id),
    ).length
  )
    c.draftState = 'ready';
  c.aggregateVersion++;
  addCollaborationEvent(s, 'component.draft_saved', actorId, c.id, { revision: next.revision });
  return next;
}
export function expireRounds(s: CollaborationState, time = Date.now()) {
  for (const c of s.components) {
    const r = findRound(c);
    if (r?.status === 'open' && r.closesAt && Date.parse(r.closesAt) <= time) {
      r.status = 'closed';
      r.closedAt = new Date(time).toISOString();
      r.closeReason = 'deadline';
      c.aggregateVersion++;
      addCollaborationEvent(s, 'component.closed', 'system', c.id, {
        revision: r.revision,
        reason: 'deadline',
      });
    }
  }
}
export function endCollaboration(s: CollaborationState) {
  s.ended = true;
  for (const c of s.components) {
    if (c.collection) c.collection.status = 'stopped';
    if (c.draftState === 'collecting') c.draftState = 'draft';
    const r = findRound(c);
    if (r?.status === 'open') {
      r.status = 'closed';
      r.closeReason = 'meeting_ended';
      r.closedAt = now();
      c.aggregateVersion++;
      addCollaborationEvent(s, 'component.closed', 'system', c.id, { reason: 'meeting_ended' });
    }
  }
}
export function applyCollaborationCommand(
  s: CollaborationState,
  actorId: string,
  raw: unknown,
): unknown {
  const command = CollaborationCommand.parse(raw);
  const actor = s.participants.find((p) => p.id === actorId && p.active);
  if (!actor || command.meetingId !== s.meetingId) fail('UNAUTHORIZED');
  const participantCommands = [
    'component.respond',
    'component.resolve_report',
    'component.delivery_ack',
    'component.report_new_issue',
  ];
  if (!participantCommands.includes(command.type) && actor.role !== 'host') fail('UNAUTHORIZED');
  if (s.ended && !['component.delivery_ack', 'component.report_new_issue'].includes(command.type))
    fail('MEETING_ENDED');
  const p = command.payload;
  if (command.type === 'component.prepare') {
    const v = z
      .object({
        content: ComponentContent.optional(),
        family: Family.optional(),
        collecting: z.boolean().optional(),
        scopeText: z.string().max(1000).optional(),
        sourceRefs: z.array(EvidenceRef).max(100).optional(),
      })
      .strict()
      .parse(p);
    if (!v.content && !v.family) fail('INVALID_COMPONENT');
    const content = v.content ?? emptyContent(v.family!);
    if (
      v.collecting &&
      s.components.filter((c) => c.collection?.status === 'collecting').length >= 4
    )
      fail('COLLECTION_LIMIT');
    const c: Component = {
      id: crypto.randomUUID(),
      meetingId: s.meetingId,
      family: content.kind,
      purposeKey: crypto.randomUUID(),
      topicRef: null,
      aggregateVersion: 0,
      revisions: [],
      draftRevision: 0,
      draftState: 'draft',
      publishedRevision: null,
      rounds: [],
      requiredAnalysisSequence: 0,
      validatedAnalysisSequence: 0,
      needsReview: false,
      missingFields: [],
      collection: v.collecting
        ? {
            scopeText: v.scopeText ?? '',
            startAfter: s.sequence,
            consumedRefs: [],
            excludedIds: [],
            status: 'collecting',
            freezeWatermark: [],
            coverage: 'complete',
          }
        : null,
    };
    saveDraft(s, c, content, actorId, v.sourceRefs ?? [{ kind: 'command', commandId: command.id }]);
    s.components.push(c);
    return c.id;
  }
  if (command.type === 'component.delivery_ack') {
    const v = z
      .object({ sequence: z.number().int().nonnegative(), viewed: z.boolean() })
      .strict()
      .parse(p);
    for (const e of s.events.filter((e) => e.sequence <= v.sequence)) {
      const c = s.components.find((c) => c.id === e.componentId);
      if (!c?.rounds.some((r) => r.audienceIds.includes(actorId))) continue;
      let receipt = s.receipts.find((r) => r.eventId === e.id && r.participantId === actorId);
      if (!receipt) {
        receipt = { eventId: e.id, participantId: actorId, deliveredAt: now(), viewedAt: null };
        s.receipts.push(receipt);
      }
      if (v.viewed) receipt.viewedAt = now();
    }
    return true;
  }
  const c = s.components.find((c) => c.id === p.componentId);
  if (!c) fail('COMPONENT_NOT_FOUND');
  if (command.type === 'component.resolve_target') {
    const v = z.object({ componentId: id, draftRevision: revision, jobId: id }).strict().parse(p);
    if (v.draftRevision !== c.draftRevision) fail('REVISION_CONFLICT');
    const pending = s.jobs.find((j) => j.id === v.jobId && j.kind === 'component');
    const intent = pending?.input as
      import('../contracts/collaboration-workflow').CollaborationIntent | undefined;
    if (
      !pending ||
      !intent ||
      intent.family !== c.family ||
      intent.resolution !== 'needs_clarification'
    )
      fail('INVALID_TARGET');
    const input = {
      ...intent,
      targetId: c.id,
      resolution: 'actionable_draft',
      operation: 'update',
    };
    pending.input = { ...intent, resolution: 'no_action' };
    s.jobs.push({
      id: crypto.randomUUID(),
      kind: 'component',
      rootEventId: command.id,
      status: 'pending',
      modelCalls: 0,
      fence: 0,
      accepted: pending.accepted,
      componentId: c.id,
      baseRevision: c.draftRevision,
      input,
    });
    addCollaborationEvent(s, 'component.target_resolved', actorId, c.id, { jobId: pending.id });
    return true;
  }
  if (command.type === 'component.resolve_report') {
    const v = z
      .object({
        componentId: id,
        reportId: id,
        expectedReportVersion: revision,
        reason: z.string().trim().min(1).max(1000),
      })
      .strict()
      .parse(p);
    const report = s.responses.find((r) => r.id === v.reportId && r.componentId === c.id);
    if (!report || report.actorId !== actorId) fail('UNAUTHORIZED');
    if (report.version !== v.expectedReportVersion || report.resolved)
      fail('RESPONSE_VERSION_CONFLICT');
    if (
      !['object', 'report_issue', 'reserve', 'disagree', 'suggest_change'].includes(
        report.response.kind,
      )
    )
      fail('INVALID_RESPONSE');
    report.resolved = true;
    c.requiredAnalysisSequence = addCollaborationEvent(s, 'report.resolved', actorId, c.id, {
      reportId: report.id,
      reason: v.reason,
    }).sequence;
    c.aggregateVersion++;
    return true;
  }
  if (command.type === 'component.report_new_issue') {
    const v = z
      .object({ componentId: id, decisionId: id, text: z.string().trim().min(1).max(1000) })
      .strict()
      .parse(p);
    const decision = s.decisions.find((d) => d.id === v.decisionId && d.componentId === c.id);
    if (!decision || !decision.participantIds.includes(actorId)) fail('UNAUTHORIZED');
    decision.reviewRequired = true;
    c.needsReview = true;
    c.aggregateVersion++;
    addCollaborationEvent(s, 'decision.issue_reported', actorId, c.id, {
      decisionId: decision.id,
      text: v.text,
    });
    return true;
  }
  if (command.type === 'component.apply_resolution') {
    const v = z
      .object({
        componentId: id,
        draftRevision: revision,
        expectedAggregateVersion: z.number().int(),
        resolutionId: id,
      })
      .strict()
      .parse(p);
    if (v.draftRevision !== c.draftRevision || v.expectedAggregateVersion !== c.aggregateVersion)
      fail('REVISION_CONFLICT');
    const content = c.revisions.at(-1)!.content;
    if (content.kind !== 'conflict') fail('INVALID_COMPONENT');
    if (
      content.payload.conflictRefs.some(
        (ref) => !s.conflicts.some((f) => f.id === ref.id && f.revision === ref.rev),
      )
    )
      fail('REVISION_CONFLICT');
    const resolution = content.payload.resolutions.find((r) => r.id === v.resolutionId);
    if (!resolution) fail('INVALID_RESOLUTION');
    const created: string[] = [];
    // Validate every referenced task before applying any of the whitelisted changes.
    for (const action of resolution.actions)
      if (
        action.kind === 'revise_task' &&
        !s.components.some((target) => {
          const draft = target.revisions.at(-1)?.content;
          return (
            draft?.kind === 'assignment' &&
            draft.payload.items.some(
              (item) =>
                (item.taskRef?.id ?? item.id) === action.taskRef.id &&
                (item.taskRef?.rev ?? item.itemRevision) === action.taskRef.rev,
            )
          );
        })
      )
        fail('REVISION_CONFLICT');
    for (const action of resolution.actions) {
      if (action.kind === 'revise_task') {
        const target = s.components.find((target) => {
          const draft = target.revisions.at(-1)?.content;
          return (
            draft?.kind === 'assignment' &&
            draft.payload.items.some((item) => (item.taskRef?.id ?? item.id) === action.taskRef.id)
          );
        })!;
        const draft = structuredClone(target.revisions.at(-1)!.content);
        if (draft.kind !== 'assignment') fail('INVALID_COMPONENT');
        const item = draft.payload.items.find(
          (item) => (item.taskRef?.id ?? item.id) === action.taskRef.id,
        )!;
        const proposed = action.proposed;
        if (
          proposed.assigneeId &&
          !s.participants.some((p) => p.id === proposed.assigneeId && p.active)
        )
          fail('INVALID_ASSIGNEE');
        if (proposed.deliverable !== undefined) item.deliverable = proposed.deliverable;
        if (proposed.assigneeId) item.assigneeId = proposed.assigneeId;
        if (proposed.dependencyRefs) item.dependencyRefs = proposed.dependencyRefs;
        if (proposed.scheduleText !== undefined)
          item.schedule = {
            rawText: proposed.scheduleText,
            start: null,
            end: null,
            dueAt: null,
            dueDate: null,
            timezone: null,
            exclusive: null,
            precision: 'unknown',
          };
        saveDraft(s, target, draft, actorId, [{ kind: 'command', commandId: command.id }], true);
        created.push(target.id);
      } else if (action.kind === 'prepare_poll') {
        const draft = emptyContent('poll');
        if (draft.kind !== 'poll') fail('INVALID_COMPONENT');
        draft.payload.question = action.question;
        draft.payload.options = action.labels.map((label) => ({
          id: crypto.randomUUID(),
          label,
          description: '',
          objectRefs: [],
        }));
        created.push(
          applyCollaborationCommand(s, actorId, {
            id: crypto.randomUUID(),
            meetingId: s.meetingId,
            type: 'component.prepare',
            payload: { content: draft },
          }) as string,
        );
      } else
        addCollaborationEvent(s, 'component.clarification', actorId, c.id, {
          question: action.question,
          participantIds: action.participantIds,
        });
    }
    addCollaborationEvent(s, 'resolution.proposed', actorId, c.id, {
      resolutionId: resolution.id,
      created,
    });
    return created;
  }
  if (command.type === 'component.edit_draft') {
    const v = z
      .object({ componentId: id, baseDraftRevision: revision, content: ComponentContent })
      .strict()
      .parse(p);
    if (v.baseDraftRevision !== c.draftRevision) fail('REVISION_CONFLICT');
    return saveDraft(s, c, v.content, actorId, [{ kind: 'command', commandId: command.id }], true)
      .revision;
  }
  if (command.type === 'component.freeze_collection') {
    z.object({ componentId: id }).strict().parse(p);
    if (c.collection) c.collection.status = 'stopped';
    c.draftState = publicationIssues(
      s,
      c,
      c.revisions.at(-1)!.content,
      s.participants.filter((p) => p.role !== 'host').map((p) => p.id),
    ).length
      ? 'draft'
      : 'ready';
    c.aggregateVersion++;
    return true;
  }
  if (command.type === 'component.publish') {
    if (c.draftState === 'cancelled') fail('DRAFT_CANCELLED');
    const v = z
      .object({
        componentId: id,
        draftRevision: revision,
        expectedAggregateVersion: z.number().int(),
        audienceIds: z.array(id).max(10),
        sourceDisclosure: z
          .array(z.object({ sourceRef: EvidenceRef, excerpt: z.string().max(1000) }).strict())
          .max(100),
      })
      .strict()
      .parse(p);
    if (c.aggregateVersion !== v.expectedAggregateVersion || c.draftRevision !== v.draftRevision)
      fail('REVISION_CONFLICT');
    if (c.collection?.status === 'collecting' || c.collection?.status === 'freezing')
      fail('COLLECTION_NOT_FROZEN');
    const content = structuredClone(
      c.revisions.find((r) => r.revision === v.draftRevision)!.content,
    );
    if (
      contentEvidence(content)
        .filter((e) => e.kind === 'segment' || e.kind === 'response')
        .some(
          (e) =>
            !v.sourceDisclosure.some(
              (d) => JSON.stringify(d.sourceRef) === JSON.stringify(e) && d.excerpt.trim(),
            ),
        )
    )
      fail('SOURCE_NOT_SHAREABLE');
    c.missingFields = publicationIssues(s, c, content, v.audienceIds);
    if (c.missingFields.length) fail(c.missingFields[0]);
    if (c.rounds.some((r) => r.revision === v.draftRevision)) fail('REVISION_ALREADY_PUBLISHED');
    if (content.kind === 'decision_confirmation')
      content.payload.requiredParticipantIds = [...v.audienceIds];
    const old = findRound(c);
    if (old?.status === 'open') {
      old.status = 'superseded';
      old.closedAt = now();
    }
    c.rounds.push({
      revision: v.draftRevision,
      content,
      status: 'open',
      audienceIds: [...v.audienceIds],
      audienceSnapshot: v.audienceIds.map((a) => ({
        id: a,
        displayName: s.participants.find((p) => p.id === a)!.displayName,
      })),
      sharedEvidence: v.sourceDisclosure.map((e) => ({ ...e, disclosedBy: actorId })),
      publishedAt: now(),
      closesAt:
        content.kind === 'poll' && content.payload.closePolicy.kind === 'deadline'
          ? content.payload.closePolicy.at
          : null,
      closedAt: null,
      closeReason: null,
      responseGate: 'open',
      reviewReasons: [],
    });
    c.publishedRevision = v.draftRevision;
    c.draftState = 'ready';
    c.aggregateVersion++;
    addCollaborationEvent(s, 'component.published', actorId, c.id, { revision: v.draftRevision });
    return c.publishedRevision;
  }
  const round = findRound(c);
  if (command.type === 'component.revalidate_round') {
    const v = z
      .object({
        componentId: id,
        publishedRevision: revision,
        expectedAggregateVersion: z.number().int(),
        reviewResultId: id,
      })
      .strict()
      .parse(p);
    if (
      !round ||
      round.revision !== v.publishedRevision ||
      c.aggregateVersion !== v.expectedAggregateVersion
    )
      fail('REVISION_CONFLICT');
    const review = s.jobs.find(
      (j) =>
        j.id === v.reviewResultId &&
        j.kind === 'impact' &&
        j.status === 'succeeded' &&
        (!j.componentId || j.componentId === c.id),
    );
    if (!review || c.validatedAnalysisSequence < c.requiredAnalysisSequence)
      fail('ANALYSIS_INCOMPLETE');
    if (c.needsReview) fail('DEPENDENCY_STALE');
    const draft = c.revisions.at(-1)!;
    const comparison = structuredClone(draft.content);
    if (comparison.kind === 'decision_confirmation')
      comparison.payload.requiredParticipantIds = round.audienceIds;
    if (JSON.stringify(comparison) !== JSON.stringify(round.content)) fail('REPUBLISH_REQUIRED');
    round.reviewedDependencies = { sourceRefs: draft.sourceRefs, objectRefs: draft.objectRefs };
    round.responseGate = 'open';
    round.reviewReasons = [];
    c.aggregateVersion++;
    addCollaborationEvent(s, 'component.revalidated', actorId, c.id, { reviewResultId: review.id });
    return true;
  }
  if (command.type === 'component.cancel' && !round) {
    c.draftState = 'cancelled';
    if (c.collection) c.collection.status = 'stopped';
    c.aggregateVersion++;
    return true;
  }
  if (!round) fail('ROUND_NOT_FOUND');
  if (p.publishedRevision !== undefined && p.publishedRevision !== round.revision)
    fail('ROUND_REPLACED');
  if (round.status !== 'open' || (round.closesAt && Date.parse(round.closesAt) <= Date.now()))
    fail('ROUND_CLOSED');
  if (command.type === 'component.respond') {
    const v = z
      .object({
        componentId: id,
        publishedRevision: revision,
        expectedResponseVersion: z.number().int().nonnegative(),
        response: ComponentResponse,
      })
      .strict()
      .parse(p);
    if (!round.audienceIds.includes(actorId)) fail('NOT_IN_AUDIENCE');
    if (round.responseGate !== 'open') fail('DEPENDENCY_STALE');
    const response = v.response;
    let subject = 'person';
    if (round.content.kind === 'poll') {
      const rules = round.content.payload;
      if (response.kind === 'vote') {
        if (
          response.optionIds.length < rules.selection.min ||
          response.optionIds.length > rules.selection.max ||
          new Set(response.optionIds).size !== response.optionIds.length ||
          response.optionIds.some((id) => !rules.options.some((o) => o.id === id))
        )
          fail('INVALID_SELECTION');
      } else if (response.kind !== 'abstain' || !rules.allowAbstain) fail('INVALID_RESPONSE');
    } else if (round.content.kind === 'decision_confirmation') {
      if (!['agree', 'reserve', 'disagree'].includes(response.kind)) fail('INVALID_RESPONSE');
    } else if (round.content.kind === 'assignment') {
      if (!('itemId' in response)) fail('INVALID_RESPONSE');
      const item = round.content.payload.items.find(
        (i) => i.id === response.itemId && i.itemRevision === response.itemRevision,
      );
      if (!item) fail('REVISION_CONFLICT');
      if (
        response.kind !== 'report_issue' &&
        (item.assigneeId !== actorId || round.content.payload.mode !== 'request_acceptance')
      )
        fail('UNAUTHORIZED');
      subject = response.kind === 'report_issue' ? response.commentId : item.id;
    } else {
      if (!['provide_context', 'support_resolution', 'suggest_resolution'].includes(response.kind))
        fail('INVALID_RESPONSE');
      if (
        response.kind === 'support_resolution' &&
        !round.content.payload.resolutions.some((r) => r.id === response.resolutionId)
      )
        fail('INVALID_RESPONSE');
      if ('commentId' in response) subject = response.commentId;
    }
    const old = currentResponses(s, c, round).find(
      (r) => r.actorId === actorId && r.subject === subject,
    );
    if ((old?.version ?? 0) !== v.expectedResponseVersion) fail('RESPONSE_VERSION_CONFLICT');
    const r: ResponseRecord = {
      id: crypto.randomUUID(),
      componentId: c.id,
      publishedRevision: round.revision,
      actorId,
      subject,
      version: v.expectedResponseVersion + 1,
      response,
      at: now(),
    };
    s.responses.push(r);
    c.aggregateVersion++;
    const event = addCollaborationEvent(s, 'response.saved', actorId, c.id, {
      responseId: r.id,
      kind: response.kind,
    });
    if (
      [
        'reserve',
        'disagree',
        'object',
        'suggest_change',
        'report_issue',
        'provide_context',
        'suggest_resolution',
      ].includes(response.kind)
    )
      c.requiredAnalysisSequence = event.sequence;
    return r;
  }
  if (
    command.type === 'component.close' ||
    command.type === 'component.cancel' ||
    command.type === 'component.record_decision'
  ) {
    const v = z
      .object({
        componentId: id,
        publishedRevision: revision,
        expectedAggregateVersion: z.number().int(),
      })
      .strict()
      .parse(p);
    if (c.aggregateVersion !== v.expectedAggregateVersion) fail('REVISION_CONFLICT');
    if (command.type === 'component.record_decision') {
      if (round.content.kind !== 'decision_confirmation') fail('INVALID_COMPONENT');
      if (c.requiredAnalysisSequence > c.validatedAnalysisSequence) fail('ANALYSIS_INCOMPLETE');
      if (c.needsReview || round.responseGate === 'blocked') fail('DEPENDENCY_STALE');
      const responses = currentResponses(s, c, round);
      if (
        !round.audienceIds.every((a) =>
          responses.some((r) => r.actorId === a && r.response.kind === 'agree'),
        )
      )
        fail('CONFIRMATION_INCOMPLETE');
      if (
        s.conflicts.some(
          (f) =>
            f.componentIds.includes(c.id) &&
            f.resolution !== 'resolved' &&
            f.verification !== 'dismissed',
        )
      )
        fail('UNRESOLVED_CONFLICT');
      s.decisions.push({
        id: crypto.randomUUID(),
        componentId: c.id,
        revision: round.revision,
        statement: round.content.payload.statement,
        participantIds: [...round.audienceIds],
        responseIds: responses.map((r) => r.id),
        at: now(),
        reviewRequired: false,
      });
    }
    round.status = command.type === 'component.cancel' ? 'cancelled' : 'closed';
    round.closedAt = now();
    round.closeReason = command.type === 'component.record_decision' ? 'recorded' : 'host';
    c.aggregateVersion++;
    addCollaborationEvent(
      s,
      command.type === 'component.record_decision' ? 'decision.recorded' : 'component.closed',
      actorId,
      c.id,
      { revision: round.revision },
    );
    return true;
  }
  fail('INVALID_COMMAND');
}
export function projectCollaboration(
  s: CollaborationState,
  actorId: string,
): CollaborationSnapshot {
  const actor = s.participants.find((p) => p.id === actorId && p.active);
  if (!actor) fail('UNAUTHORIZED');
  const host = actor.role === 'host';
  return structuredClone({
    meetingId: s.meetingId,
    actor,
    participants: s.participants,
    sequence: s.sequence,
    ended: s.ended,
    components: s.components.flatMap((c) => {
      const round = findRound(c);
      if (!host && !round?.audienceIds.includes(actorId)) return [];
      const records = round ? currentResponses(s, c, round) : [];
      const visible = round && (host || round.audienceIds.includes(actorId)) ? round : null;
      const result =
        visible?.content.kind === 'poll' && visible.status !== 'open'
          ? pollResult(visible, records)
          : null;
      const statuses =
        visible && visible.content.kind !== 'poll'
          ? records.map((r) => ({
              participantId: r.actorId,
              subject: r.subject,
              kind: r.response.kind,
            }))
          : [];
      return [
        {
          id: c.id,
          family: c.family,
          aggregateVersion: c.aggregateVersion,
          ...(host
            ? {
                draft: c.revisions.at(-1),
                draftRevision: c.draftRevision,
                draftState: c.draftState,
              }
            : {}),
          round: visible,
          responded: new Set(records.map((r) => r.actorId)).size,
          ownResponses: records.filter((r) => r.actorId === actorId),
          statuses,
          ...(host && (!round || round.content.kind !== 'poll' || round.status !== 'open')
            ? { responses: records }
            : {}),
          result,
          missingFields: host ? c.missingFields : [],
          needsReview: c.needsReview,
        },
      ];
    }),
    ...(host
      ? {
          conflicts: s.conflicts,
          jobs: s.jobs,
          notices: s.events
            .filter((e) =>
              ['component.clarification', 'component.suggested_action'].includes(e.type),
            )
            .slice(-8),
        }
      : {}),
    decisions: s.decisions.filter((d) => host || d.participantIds.includes(actorId)),
  });
}
