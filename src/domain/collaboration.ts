import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  CollaborationProposal,
  DraftContent,
  type IntentCandidate,
  type IntentDraft,
} from '../contracts/collaboration';
import type { Meeting, Proposal, Ref } from '../contracts/model';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sameRef = (a: Ref, b: Ref) => a.id === b.id && a.rev === b.rev;
const union = (a: Ref[], b: Ref[]) => [...a, ...b.filter((r) => !a.some((x) => sameRef(x, r)))];
const inert = (i: IntentCandidate) =>
  ['negated', 'hypothetical', 'quoted'].includes(i.expression) ||
  ['no_action', 'unsupported'].includes(i.resolution);
const entries = (c: DraftContent | null) =>
  !c
    ? []
    : c.kind === 'poll'
      ? c.options
      : c.kind === 'assignment'
        ? c.items
        : c.kind === 'conflict'
          ? c.sides
          : [];

function assertSources(refs: Ref[], m: Meeting) {
  for (const r of refs) {
    if (
      !m.segments.some((s) => sameRef(s, r) && s.kind !== 'request' && s.finality !== 'partial') ||
      m.segments.some((s) => s.id === r.id && s.rev > r.rev)
    )
      throw new Error('INTENT_SOURCE_INVALID');
  }
}
export function validateCollaboration(p: Proposal, m: Meeting) {
  if (!p.collaboration) return;
  const batch = CollaborationProposal.parse(p.collaboration);
  if (batch.intents.length && (!m.collaboration?.enabled || m.contextScope === 'personal'))
    throw new Error('COLLABORATION_DISABLED');
  if (batch.coverage === 'partial' && !batch.unprocessedRefs.length)
    throw new Error('INTENT_COVERAGE_REQUIRED');
  if (batch.coverage === 'complete' && batch.unprocessedRefs.length)
    throw new Error('INTENT_COVERAGE_INVALID');
  assertSources(batch.unprocessedRefs, m);
  const seen = new Set<string>();
  for (const i of batch.intents) {
    if (
      seen.has(i.localId) ||
      i.dependsOnLocalIds.some((id) => !seen.has(id)) ||
      (i.targetLocalId &&
        (!seen.has(i.targetLocalId) || !i.dependsOnLocalIds.includes(i.targetLocalId)))
    )
      throw new Error('INTENT_DEPENDENCY_INVALID');
    if (
      i.targetLocalId &&
      batch.intents.find((x) => x.localId === i.targetLocalId)?.family !== i.family
    )
      throw new Error('INTENT_FAMILY_MISMATCH');
    seen.add(i.localId);
    if (i.target && i.targetLocalId) throw new Error('INTENT_TARGET_INVALID');
    if (!i.evidence.length) throw new Error('INTENT_EVIDENCE_REQUIRED');
    assertSources(i.evidence, m);
    if (i.content && i.content.kind !== i.family) throw new Error('INTENT_FAMILY_MISMATCH');
    if (
      i.target &&
      !m.collaboration?.drafts.some(
        (d) =>
          d.id === i.target!.id &&
          d.rev === i.target!.rev &&
          d.candidate.family === i.family &&
          d.status !== 'dismissed',
      )
    )
      throw new Error('INTENT_TARGET_STALE');
    for (const r of [
      ...i.referencedObjects,
      ...(i.topicRef ? [i.topicRef] : []),
      ...(i.content?.kind === 'assignment' ? i.content.items.flatMap((x) => x.dependencies) : []),
    ]) {
      if (
        !m.objects.some((o) => sameRef(o, r)) &&
        !p.objects.some(
          (o) => o.id === r.id && r.rev === (m.objects.find((x) => x.id === o.id)?.rev ?? 0) + 1,
        )
      )
        throw new Error('INTENT_OBJECT_INVALID');
    }
    const rows = entries(i.content);
    if (new Set(rows.map((x) => x.key)).size !== rows.length)
      throw new Error('INTENT_DUPLICATE_KEY');
    for (const row of rows) {
      if (!row.sources.length) throw new Error('INTENT_EVIDENCE_REQUIRED');
      assertSources(row.sources, m);
      if (row.sources.some((r) => !i.evidence.some((x) => sameRef(x, r))))
        throw new Error('INTENT_FIELD_EVIDENCE');
    }
    if (i.content?.kind === 'assignment')
      for (const item of i.content.items) {
        const quotes = item.sources.map((r) => m.segments.find((s) => sameRef(s, r))!.text);
        for (const field of [item.owner, item.time])
          if (field !== null && (!field.trim() || !quotes.some((q) => q.includes(field))))
            throw new Error('INTENT_UNGROUNDED_FIELD');
      }
    if (i.content?.kind === 'poll') {
      const labels = i.content.options.map((o) => o.label.trim().normalize('NFKC').toLowerCase());
      if (labels.some((l) => !l) || new Set(labels).size !== labels.length)
        throw new Error('DUPLICATE_OPTIONS');
    }
  }
}

export function missingFields(content: DraftContent | null): string[] {
  if (!content) return ['content'];
  switch (content.kind) {
    case 'poll':
      return [
        ...(!content.question.trim() ? ['question'] : []),
        ...(content.options.length < 2 ? ['options'] : []),
      ];
    case 'assignment':
      return [
        ...(!content.items.length ? ['items'] : []),
        ...content.items.flatMap((x) => [
          ...(!x.task.trim() ? [`${x.key}:task`] : []),
          ...(!x.deliverable.trim() ? [`${x.key}:deliverable`] : []),
          ...(x.owner === null ? [`${x.key}:owner`] : []),
          ...(x.time === null ? [`${x.key}:time`] : []),
        ]),
      ];
    case 'conflict':
      return [
        ...(!content.summary.trim() ? ['summary'] : []),
        ...(!content.sides.length ? ['sides'] : []),
      ];
    case 'decision_confirmation':
      return [
        ...(!content.statement.trim() ? ['statement'] : []),
        ...(!content.scopeText.trim() ? ['scopeText'] : []),
      ];
  }
}
function archive(d: IntentDraft) {
  d.history.push({
    rev: d.rev,
    content: structuredClone(d.content),
    sources: structuredClone(d.sources),
  });
  d.rev++;
}
function purpose(i: IntentCandidate) {
  return hash([
    i.family,
    i.topicRef?.id ?? null,
    [...i.referencedObjects.map((r) => r.id)].sort(),
    i.scopeText.trim(),
    !i.topicRef && !i.referencedObjects.length ? i.evidence : null,
  ]);
}
function mergedContent(d: IntentDraft, incoming: DraftContent): DraftContent {
  const result = structuredClone(incoming) as any;
  const old = d.content as any;
  if (!old || old.kind !== incoming.kind) return incoming;
  for (const field of ['options', 'items', 'sides'])
    if (Array.isArray(result[field])) {
      const previous = old[field] as Array<{ key: string }>;
      result[field] = [
        ...previous.filter((x) => !result[field].some((v: any) => v.key === x.key)),
        ...result[field],
      ].filter((x: any) => !d.tombstones.includes(`${field}.${x.key}`));
    }
  for (const path of d.manualLocks) {
    const [field, key, property] = path.split('.');
    if (!key) result[field] = structuredClone(old[field]);
    else {
      const prior = old[field]?.find((x: any) => x.key === key);
      const next = result[field]?.find((x: any) => x.key === key);
      if (prior && next && property) next[property] = prior[property];
    }
  }
  const parsed = DraftContent.parse(result);
  if (
    parsed.kind === 'poll' &&
    new Set(parsed.options.map((o) => o.label.trim().normalize('NFKC').toLowerCase())).size !==
      parsed.options.length
  )
    throw new Error('DUPLICATE_OPTIONS');
  return parsed;
}
export function applyCollaboration(m: Meeting, p: Proposal, accepted: Ref[], eventId: string) {
  const state = m.collaboration;
  if (!state?.enabled || !p.collaboration || m.contextScope === 'personal') return;
  if (state.processedEvents.includes(eventId)) return;
  const mapped = new Map<string, IntentDraft>();
  for (const original of p.collaboration.intents) {
    if (inert(original) || original.dependsOnLocalIds.some((id) => !mapped.has(id))) continue;
    const i = structuredClone(original);
    if (i.targetLocalId) {
      const local = mapped.get(i.targetLocalId);
      if (!local) continue;
      i.target = { id: local.id, rev: local.rev };
    }
    const actionOnly = !['prepare', 'update', 'propose_resolution'].includes(i.operation);
    const separate =
      actionOnly ||
      i.resolution === 'needs_clarification' ||
      i.expression === 'suggested' ||
      i.resolution === 'suggestion';
    const key = separate ? hash([purpose(i), i.operation, i.target, i.resolution]) : purpose(i);
    let d = i.target && !separate ? state.drafts.find((x) => x.id === i.target!.id) : undefined;
    const matches = state.drafts.filter((x) => x.purposeKey === key);
    if (!d && matches.length === 1) d = matches[0];
    if (d?.status === 'dismissed') {
      if (hash(d.candidate.referencedObjects) === hash(i.referencedObjects)) continue;
      d = undefined;
    }
    const needsTarget = !d && !i.target && !['prepare', 'propose_resolution'].includes(i.operation);
    const ambiguous =
      needsTarget || (!i.target && matches.length > 1) || i.resolution === 'needs_clarification';
    const suggestion = actionOnly || i.expression === 'suggested' || i.resolution === 'suggestion';
    if (!d) {
      d = {
        id: randomUUID(),
        rev: 1,
        purposeKey: key,
        candidate: i,
        status: ambiguous
          ? 'needs_clarification'
          : suggestion
            ? 'suggestion'
            : i.collectionMode === 'prospective' && m.status === 'active'
              ? 'collecting'
              : 'draft',
        content: null,
        sources: [],
        manualLocks: [],
        tombstones: [],
        suggestedContent: null,
        needsReview: false,
        missingFields: [],
        consumedRefs: [],
        startVersion: Math.max(
          0,
          ...accepted.map((r) => m.segments.find((s) => sameRef(s, r))?.version ?? 0),
        ),
        freezeRefs: null,
        history: [],
      };
      if (
        d.status === 'collecting' &&
        state.drafts.filter((x) => x.status === 'collecting').length >= 4
      ) {
        d.status = 'suggestion';
        d.needsReview = true;
      }
      state.drafts.push(d);
    } else {
      if (d.freezeRefs && !separate) continue;
      if (
        d.candidate.collectionMode === 'prospective' &&
        i.operation === 'update' &&
        !i.evidence.some(
          (r) =>
            accepted.some((x) => sameRef(x, r)) &&
            (m.segments.find((s) => sameRef(s, r))?.version ?? 0) > d!.startVersion,
        )
      )
        continue;
      if (
        hash(d.content) === hash(i.content) &&
        hash(d.candidate.referencedObjects) === hash(i.referencedObjects) &&
        !actionOnly &&
        !ambiguous
      ) {
        mapped.set(i.localId, d);
        continue;
      }
      archive(d);
    }
    mapped.set(i.localId, d);
    if (i.content && !actionOnly && !ambiguous) {
      const next = mergedContent(d, i.content);
      d.suggestedContent = hash(next) !== hash(i.content) ? i.content : null;
      d.content = next;
    } else if (i.content && !d.content) d.content = i.content;
    if (d.candidate.collectionMode === 'prospective' && i.operation === 'update')
      i.collectionMode = 'prospective';
    d.candidate = i;
    d.sources = union(d.sources, i.evidence);
    d.consumedRefs = union(
      d.consumedRefs,
      i.evidence.filter((r) => accepted.some((x) => sameRef(x, r))),
    );
    d.missingFields = [...new Set([...missingFields(d.content), ...i.missingSlots])];
    if (ambiguous) d.status = 'needs_clarification';
    else if (suggestion) d.status = 'suggestion';
  }
  state.processedEvents.push(eventId);
  state.unprocessedRefs = union(
    state.unprocessedRefs.filter((r) => !accepted.some((x) => sameRef(x, r))),
    p.collaboration.unprocessedRefs,
  );
  state.coverage = state.unprocessedRefs.length ? 'partial' : 'complete';
  state.revision++;
  refreshCollaboration(m);
}

export function refreshCollaboration(m: Meeting) {
  for (const d of m.collaboration?.drafts ?? []) {
    if (
      d.sources.some((r) => m.segments.some((s) => s.id === r.id && s.rev > r.rev)) ||
      d.candidate.referencedObjects.some((r) =>
        m.objects.some((o) => o.id === r.id && o.rev !== r.rev),
      )
    )
      d.needsReview = true;
    if (m.status === 'ended' && d.status === 'collecting') {
      archive(d);
      d.status = 'draft';
    }
  }
}
const targetPayload = z.object({
  draftId: z.string(),
  expectedRevision: z.number().int().positive(),
});
export function collaborationCommand(m: Meeting, type: string, payload: Record<string, unknown>) {
  if (m.status !== 'active') throw new Error('MEETING_ENDED');
  if (type === 'collaborationEnable') {
    const p = z.object({ enabled: z.boolean() }).strict().parse(payload);
    m.collaboration ??= {
      enabled: false,
      revision: 0,
      drafts: [],
      processedEvents: [],
      coverage: 'complete',
      unprocessedRefs: [],
    };
    m.collaboration.enabled = p.enabled;
    m.collaboration.revision++;
    return null;
  }
  const state = m.collaboration;
  if (!state?.enabled) throw new Error('COLLABORATION_DISABLED');
  const base = targetPayload.parse(payload);
  const d = state.drafts.find((x) => x.id === base.draftId);
  if (!d || d.rev !== base.expectedRevision || d.status === 'dismissed')
    throw new Error('INTENT_TARGET_STALE');
  if (type === 'collaborationDismiss') {
    targetPayload.strict().parse(payload);
    archive(d);
    d.status = 'dismissed';
  } else if (type === 'collaborationFreeze') {
    targetPayload.strict().parse(payload);
    const pending = m.segments.filter(
      (s) =>
        s.kind !== 'request' &&
        s.finality !== 'partial' &&
        !m.segments.some((x) => x.id === s.id && x.rev > s.rev) &&
        m.processedSources?.[s.id] !== s.rev,
    );
    if (pending.length || state.coverage === 'partial') throw new Error('ANALYSIS_INCOMPLETE');
    if (d.status !== 'collecting') throw new Error('NOT_COLLECTING');
    archive(d);
    d.freezeRefs = m.segments
      .filter((s) => s.kind !== 'request' && s.finality !== 'partial')
      .map(({ id, rev }) => ({ id, rev }));
    d.status = 'draft';
  } else if (type === 'collaborationResolve') {
    const p = targetPayload
      .extend({ target: z.object({ id: z.string(), rev: z.number() }).strict() })
      .strict()
      .parse(payload);
    const target = state.drafts.find(
      (x) =>
        x.id === p.target.id &&
        x.rev === p.target.rev &&
        x.id !== d.id &&
        x.candidate.family === d.candidate.family &&
        x.status !== 'dismissed' &&
        x.status !== 'needs_clarification',
    );
    if (!target || d.status !== 'needs_clarification') throw new Error('INTENT_TARGET_STALE');
    archive(d);
    d.candidate.target = p.target;
    d.status = 'suggestion';
  } else if (type === 'collaborationEdit') {
    const p = targetPayload
      .extend({ path: z.string().max(200), value: z.unknown() })
      .strict()
      .parse(payload);
    if (!d.content) throw new Error('MISSING_CONTENT');
    const content = structuredClone(d.content) as any;
    const [field, key, property, extra] = p.path.split('.');
    const fields: Record<string, string[]> = {
      poll: ['question', 'selection', 'options'],
      assignment: ['items'],
      conflict: ['summary', 'sides', 'questions', 'resolutions'],
      decision_confirmation: ['statement', 'scopeText', 'conditions'],
    };
    if (!fields[content.kind].includes(field) || extra) throw new Error('INVALID_DRAFT_FIELD');
    let tombstone: string | null = null;
    if (['options', 'items', 'sides'].includes(field)) {
      const row = content[field].find((x: any) => x.key === key);
      if (!row) throw new Error('INVALID_DRAFT_FIELD');
      if (!property && p.value === null) {
        content[field] = content[field].filter((x: any) => x.key !== key);
        tombstone = p.path;
      } else {
        const allowed =
          field === 'options'
            ? ['label']
            : field === 'items'
              ? ['task', 'deliverable', 'owner', 'time']
              : ['description'];
        if (!allowed.includes(property)) throw new Error('INVALID_DRAFT_FIELD');
        row[property] = p.value;
      }
    } else {
      if (key) throw new Error('INVALID_DRAFT_FIELD');
      content[field] = p.value;
    }
    const parsed = DraftContent.parse(content);
    if (
      parsed.kind === 'poll' &&
      new Set(parsed.options.map((x) => x.label.trim().normalize('NFKC').toLowerCase())).size !==
        parsed.options.length
    )
      throw new Error('DUPLICATE_OPTIONS');
    archive(d);
    d.content = parsed;
    if (tombstone) d.tombstones.push(tombstone);
    else if (!d.manualLocks.includes(p.path)) d.manualLocks.push(p.path);
    d.missingFields = missingFields(d.content);
  } else throw new Error('INVALID_COMMAND');
  state.revision++;
  return d.id;
}
