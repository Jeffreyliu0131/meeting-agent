import type { Meeting, Segment, Ref } from '../contracts/model';
import { dependencies, objectSources, refsCurrent } from '../domain/meaning';

export function latestSegments(meeting: Meeting): Segment[] {
  const map = new Map<string, Segment>();
  for (const s of meeting.segments)
    if (!map.has(s.id) || map.get(s.id)!.rev < s.rev) map.set(s.id, s);
  return [...map.values()].sort(
    (a, b) =>
      (a.captureStartMs ?? Date.parse(a.receivedAt)) -
        (b.captureStartMs ?? Date.parse(b.receivedAt)) ||
      a.channel.localeCompare(b.channel) ||
      (a.channelSequence ?? a.order) - (b.channelSequence ?? b.order),
  );
}
export function sourceVersion(s: Segment) {
  return s.version ?? s.order;
}
export function pendingSegments(m: Meeting) {
  return latestSegments(m)
    .filter((s) => s.finality !== 'partial')
    .filter((s) => m.quarantinedSources?.[s.id] !== s.rev)
    .filter((s) =>
      m.processedSources
        ? m.processedSources[s.id] !== s.rev
        : sourceVersion(s) > m.understoodVersion,
    );
}
const bytes = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length;
function terms(text: string) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
  const stop = new Set([
    'the',
    'and',
    'that',
    'this',
    'with',
    'from',
    'what',
    'were',
    'was',
    'for',
    'about',
    '我们',
    '这个',
    '那个',
  ]);
  const result = new Set(words.filter((w) => w.length > 1 && !stop.has(w)));
  for (const run of text.match(/[\p{Script=Han}]+/gu) || [])
    for (let i = 0; i + 1 < run.length; i++) result.add(run.slice(i, i + 2));
  return result;
}
function similarity(query: Set<string>, value: string) {
  const other = terms(value);
  let score = 0;
  for (const term of query) if (other.has(term)) score++;
  return score;
}
export type ContextBatch = { meeting: Meeting; accepted: Ref[]; pending: number; bytes: number };
/** Bounded, source-backed retrieval. No model-generated summary replaces original evidence. */
export function buildContextBatch(m: Meeting, maxBytes = 28000): ContextBatch {
  const pending = pendingSegments(m).sort((a, b) => sourceVersion(a) - sourceVersion(b));
  const selected: Segment[] = [];
  const batchLimit = Math.max(2000, Math.floor(maxBytes * 0.36));
  for (const s of pending) {
    if (selected.length && (selected[0].kind === 'request' || s.kind === 'request')) break;
    if (selected.length && (bytes([...selected, s]) > batchLimit || selected.length >= 24)) break;
    selected.push(s);
    if (bytes(selected) > batchLimit) break; // An indivisible source is retained, never clipped.
  }
  const scope = selected[0]?.kind === 'request' ? 'personal' : 'meeting';
  m = scopedContext(m, scope);
  const all = latestSegments(m);
  const query = terms(selected.map((s) => s.text).join(' ') || m.focus);
  const ranked = [...m.objects]
    .map((o) => ({
      o,
      score:
        similarity(query, o.title + ' ' + o.detail) +
        (o.sources.some((r) => selected.some((s) => s.id === r.id)) ? 20 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const essentialIds = new Set(
    m.objects
      .filter(
        (o) =>
          o.lifecycle === 'active' &&
          (o.kind === 'constraint' ||
            o.kind === 'question' ||
            o.status === 'disputed' ||
            o.reviewRequired ||
            o.meaning?.stance === 'committed' ||
            o.meaning?.stance === 'conditional'),
      )
      .map((o) => o.id),
  );
  // Keep unresolved obligations even when the new utterance shares no words with them.
  for (const id of essentialIds)
    for (const dependency of dependencies(m, id)) essentialIds.add(dependency);
  const objects = ranked
    .filter((x) => x.score > 0)
    .slice(0, 20)
    .map((x) => x.o);
  for (const o of m.objects)
    if (essentialIds.has(o.id) && !objects.some((x) => x.id === o.id)) objects.unshift(o);
  // Recent context also resolves pronouns and topic continuations with no keyword overlap.
  for (const o of m.objects.slice(-8)) if (!objects.some((x) => x.id === o.id)) objects.push(o);
  const ids = new Set(objects.map((o) => o.id));
  const relations = m.relations.filter((r) => ids.has(r.from) || ids.has(r.to)).slice(-40);
  for (const r of relations)
    for (const id of [r.from, r.to]) {
      const o = m.objects.find((x) => x.id === id);
      if (o && !ids.has(id)) {
        objects.push(o);
        ids.add(id);
      }
    }
  const mandatoryIds = new Set(selected.map((s) => s.id));
  for (const d of m.decisions.filter((d) => d.scope === 'meeting'))
    for (const r of d.sources) mandatoryIds.add(r.id);
  const references = [...objects.flatMap(objectSources), ...relations.flatMap((r) => r.sources)];
  const recalled = all
    .map((s) => ({ s, score: similarity(query, s.text) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.s);
  const extras = all
    .filter((s) => mandatoryIds.has(s.id) || references.some((r) => r.id === s.id))
    .concat(recalled, all.slice(-8));
  const sources = new Map(selected.map((s) => [s.id, s]));
  for (const s of extras) if (!sources.has(s.id)) sources.set(s.id, s);
  for (const o of objects.filter((o) => essentialIds.has(o.id)))
    for (const ref of objectSources(o)) mandatoryIds.add(ref.id);
  const projected = structuredClone(m);
  projected.objects = objects;
  projected.relations = relations;
  projected.segments = [...sources.values()];
  // Only one relevant current artifact is included. The provider sends a compact index separately.
  const latest = new Map(m.artifacts.map((a) => [a.id, a]));
  projected.contextIndex = {
    artifacts: [...latest.values()].slice(0, 100).map((a) => ({
      id: a.id,
      rev: a.rev,
      purposeKey: a.purposeKey,
      question: a.question,
      objectIds: a.objectIds,
    })),
    objects: m.objects.slice(0, 150).map((o) => ({
      id: o.id,
      rev: o.rev,
      kind: o.kind,
      title: o.title,
      lifecycle: o.lifecycle,
      reviewRequired: o.reviewRequired,
    })),
    coverage: {
      total: m.objects.length + latest.size,
      loaded: Math.min(m.objects.length, 150) + Math.min(latest.size, 100),
      hasMore: m.objects.length > 150 || latest.size > 100,
    },
  };
  const requestContext = selected.find((s) => s.kind === 'request')?.requestContext;
  for (const ref of requestContext?.objectRefs ?? []) {
    const version = [...(m.objectHistory ?? []), ...m.objects].find(
      (o) => o.id === ref.id && o.rev === ref.rev,
    );
    if (!version) throw new Error('REQUEST_OBJECT_NOT_FOUND');
    projected.objects = projected.objects.filter((o) => o.id !== ref.id).concat(version);
    essentialIds.add(ref.id);
    for (const sourceRef of objectSources(version)) {
      const source = m.segments.find((s) => s.id === sourceRef.id && s.rev === sourceRef.rev);
      if (source && !projected.segments.some((s) => s.id === source.id && s.rev === source.rev))
        projected.segments.push(source);
      mandatoryIds.add(sourceRef.id);
    }
  }
  const requested = requestContext
    ? m.artifacts.find(
        (a) => a.id === requestContext.artifactId && a.rev === requestContext.artifactRev,
      )
    : undefined;
  const candidates = [...latest.values()].sort(
    (a, b) =>
      similarity(query, b.question + ' ' + b.summary) -
      similarity(query, a.question + ' ' + a.summary),
  );
  projected.artifacts = requested ? [requested] : candidates.slice(0, 1);
  const size = () => bytes(contextPayload(projected));
  // Optional context may be reduced. Never drop an unprocessed source or its correction.
  while (size() > maxBytes && projected.artifacts.length && !requested) projected.artifacts.pop();
  while (size() > maxBytes && projected.objects.some((o) => !essentialIds.has(o.id))) {
    const index = projected.objects.map((o) => essentialIds.has(o.id)).lastIndexOf(false);
    projected.objects.splice(index, 1);
    projected.relations = projected.relations.filter(
      (r) =>
        projected.objects.some((o) => o.id === r.from) &&
        projected.objects.some((o) => o.id === r.to),
    );
  }
  while (size() > maxBytes && projected.segments.some((s) => !mandatoryIds.has(s.id))) {
    const i = projected.segments.map((s) => mandatoryIds.has(s.id)).lastIndexOf(false);
    projected.segments.splice(i, 1);
  }
  // Keep a paged directory when full obligation evidence exceeds one context.
  // Omitted evidence is explicitly incomplete, never a withdrawal of the stored condition.
  while (size() > maxBytes && projected.objects.length && !requestContext?.objectRefs?.length) {
    projected.contextIndex!.coverage.incompleteEvidence = true;
    projected.objects.pop();
    projected.relations = projected.relations.filter(
      (r) =>
        projected.objects.some((o) => o.id === r.from) &&
        projected.objects.some((o) => o.id === r.to),
    );
    const required = new Set([
      ...selected.map((s) => s.id),
      ...projected.objects.flatMap(objectSources).map((r) => r.id),
      ...m.decisions
        .filter((d) => d.scope === 'meeting')
        .flatMap((d) => d.sources)
        .map((r) => r.id),
    ]);
    projected.segments = projected.segments.filter((s) => required.has(s.id));
  }
  while (
    size() > maxBytes &&
    projected.contextIndex &&
    (projected.contextIndex.objects.length || projected.contextIndex.artifacts.length)
  ) {
    const index = projected.contextIndex;
    if (index.objects.length) index.objects.pop();
    else index.artifacts.pop();
    index.coverage.hasMore = true;
    index.coverage.loaded = index.objects.length + index.artifacts.length;
  }
  if (size() > maxBytes)
    throw new Error(
      requested
        ? 'REQUEST_CONTEXT_TOO_LARGE'
        : essentialIds.size
          ? 'CONTEXT_MEMORY_LIMIT'
          : 'CONTEXT_SOURCE_TOO_LARGE',
    );
  // Known omission is exposed to the model; it must not guess missing historical conditions.
  projected.inputVersion =
    selected.length === pending.length
      ? m.inputVersion
      : selected.length
        ? Math.max(...selected.map(sourceVersion))
        : m.understoodVersion;
  projected.segments = latestSegments(projected);
  if (scope === 'personal') {
    const fixed = [
      ...(requested?.sources ?? []),
      ...projected.objects
        .filter((o) => requestContext?.objectRefs?.some((r) => r.id === o.id && r.rev === o.rev))
        .flatMap(objectSources),
    ];
    for (const ref of fixed) {
      const original = m.segments.find((s) => s.id === ref.id && s.rev === ref.rev);
      if (original)
        projected.segments = projected.segments.filter((s) => s.id !== ref.id).concat(original);
    }
  }
  return {
    meeting: projected,
    accepted: selected.map((s) => ({ id: s.id, rev: s.rev })),
    pending: pending.length - selected.length,
    bytes: size(),
  };
}
export function scopedContext(meeting: Meeting, scope: 'meeting' | 'personal'): Meeting {
  const m = structuredClone(meeting);
  m.contextScope = scope;
  delete m.workflowJobs;
  delete m.failedExpression;
  m.expressionJobs = [];
  m.calls = [];
  if (scope === 'meeting') {
    m.segments = m.segments.filter((s) => s.kind !== 'request' && s.finality !== 'partial');
    m.clarifications = m.clarifications?.filter((c) => !c.branchId);
    m.objectHistory = m.objectHistory?.filter((o) =>
      objectSources(o).every((r) => m.segments.some((s) => s.id === r.id)),
    );
    m.artifacts = m.artifacts.filter((a) => (a.scope ?? 'meeting') === 'meeting');
    m.decisions = m.decisions.filter((d) => d.scope === 'meeting');
    m.scenarios = [];
    // Protect restored stores from pre-isolation objects already citing a personal request.
    m.objects = m.objects.filter((o) =>
      objectSources(o).every((r) => m.segments.some((s) => s.id === r.id)),
    );
    const ids = new Set(m.objects.map((o) => o.id));
    m.relations = m.relations.filter(
      (r) =>
        ids.has(r.from) &&
        ids.has(r.to) &&
        r.sources.every((ref) => m.segments.some((s) => s.id === ref.id)),
    );
  }
  return m;
}
export function contextPayload(meeting: Meeting) {
  const m = scopedContext(meeting, meeting.contextScope ?? 'meeting');
  const current = m.artifacts.at(-1);
  return {
    intentPreparation:
      m.contextScope !== 'personal' && m.intentPreparation?.enabled
        ? {
            ...m.intentPreparation,
            processedEvents: undefined,
            drafts: m.intentPreparation.drafts.map(({ history, ...d }) => d),
          }
        : null,
    clarifications: m.clarifications?.filter((c) => c.status === 'pending') ?? [],
    personalRequest:
      m.contextScope === 'personal' ? (m.segments.find((s) => s.kind === 'request') ?? null) : null,
    scope: m.contextScope,
    outputLocale: m.outputLocale,
    timezone: m.timezone,
    meetingDate: m.createdAt,
    understoodVersion: m.understoodVersion,
    inputVersion: m.inputVersion,
    segments: m.segments,
    objects: m.objects,
    relations: m.relations,
    focus: m.focus,
    title: { text: m.title, ...m.titleMeta },
    decisions: m.decisions.map((d) => ({
      id: d.id,
      target: { question: d.artifact.question, summary: d.artifact.summary },
      evidenceChanged: !refsCurrent(d.sources, m),
      scope: d.scope,
      basis: d.basis,
      participants: d.participants,
      sources: d.sources,
    })),
    scenarios: m.scenarios.slice(-2).map((s) => ({
      scope: 'personal',
      baseInputVersion: s.baseInputVersion,
      values: s.values,
      result: s.result,
    })),
    toolObservations: m.toolObservations ?? [],
    memoryIndex: m.contextIndex ?? null,
    artifactIndex:
      m.contextIndex?.artifacts ??
      m.artifacts.map((a) => ({
        id: a.id,
        rev: a.rev,
        purposeKey: a.purposeKey,
        question: a.question,
        blocks: a.blocks.map((b) => ({
          id: b.id,
          type: b.type,
          title: b.title,
          objectIds: b.objectIds,
        })),
      })),
    currentArtifact: current
      ? {
          id: current.id,
          rev: current.rev,
          purposeKey: current.purposeKey,
          question: current.question,
          summary: current.summary,
          blocks: current.blocks,
          formulas: current.formulas,
        }
      : null,
    contextPolicy:
      'Relevant evidence projection, not complete meeting history. Preserve unmentioned objects. Missing evidence remains unknown.',
  };
}
