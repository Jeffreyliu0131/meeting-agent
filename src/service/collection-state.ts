import { collectionDecisions } from '../domain/collection-decisions';
import type {
  CollectionAlias,
  CollectionReport,
  Meeting,
  ObjectState,
  Ref,
  RelationState,
  Segment,
} from '../contracts/model';
import type { CollectionDigest } from '../domain/collection-digest';

/**
 * A report cites aliases, never real ids. These helpers walk it structurally
 * rather than field-by-field: the Block union has many shapes and a new one must
 * not be able to slip past citation checking by being added later.
 */
type Citations = {
  sources: Array<[Ref, string]>;
  objects: Array<[string, string]>;
  relations: Array<[string, string]>;
};

function collect(node: unknown, path: string, acc: Citations): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((value, i) => collect(value, `${path}[${i}]`, acc));
    return;
  }
  const record = node as Record<string, unknown>;
  // A bare {id, rev} is a source ref anywhere it appears.
  if (
    typeof record.id === 'string' &&
    typeof record.rev === 'number' &&
    Object.keys(record).length === 2
  ) {
    acc.sources.push([{ id: record.id, rev: record.rev }, path]);
    return;
  }
  if (Array.isArray(record.objectIds))
    for (const id of record.objectIds)
      if (typeof id === 'string') acc.objects.push([id, `${path}.objectIds`]);
  if (typeof record.relationId === 'string')
    acc.relations.push([record.relationId, `${path}.relationId`]);
  for (const [key, value] of Object.entries(record)) collect(value, `${path}.${key}`, acc);
}

/**
 * Validates every citation against the alias map and returns the aliases the
 * report actually used. Mirrors resolveNewRefs / ID_KIND_MISMATCH for the
 * batch-local `new_` ids: an unknown alias is a rejection, not a silent null.
 */
export function resolveAliases(
  report: CollectionReport,
  aliasMap: Record<string, CollectionAlias>,
): CollectionAlias[] {
  const acc: Citations = { sources: [], objects: [], relations: [] };
  collect(report, 'report', acc);
  const used = new Set<string>();
  const check = (alias: string, kind: CollectionAlias['kind'], where: string) => {
    const found = aliasMap[alias];
    if (!found) throw new Error('UNKNOWN_ALIAS');
    if (found.kind !== kind && !(kind === 'source' && found.kind === 'decision'))
      throw new Error('ALIAS_KIND_MISMATCH');
    used.add(alias);
    void where;
  };
  for (const [ref, where] of acc.sources) check(ref.id, 'source', where);
  for (const [id, where] of acc.objects) check(id, 'object', where);
  for (const [id, where] of acc.relations) check(id, 'relation', where);
  return Object.values(aliasMap).filter((a) => used.has(a.alias));
}

/**
 * A synthetic single meeting whose ids ARE the aliases, so validateRefs,
 * validateArtifact and artifactIsStale work on a collection report unchanged.
 *
 * Member meetings are scoped to meeting content first: personal request segments
 * and personal artifacts must never cross into a shared report.
 */
export function syntheticCollectionMeeting(
  aliasMap: Record<string, CollectionAlias>,
  meetings: Meeting[],
): Meeting {
  const byId = new Map(meetings.map((m) => [m.id, m]));
  const segments: Segment[] = [];
  const objects: ObjectState[] = [];
  const relations: RelationState[] = [];
  for (const alias of Object.values(aliasMap)) {
    const m = byId.get(alias.meetingId);
    if (!m) continue;
    if (alias.kind === 'source') {
      const found = m.segments.find((s) => s.id === alias.id && s.rev === alias.rev);
      // A request segment is personal speech and is never part of a shared report.
      if (found && found.kind !== 'request' && found.finality !== 'partial')
        segments.push({ ...found, id: alias.alias });
    } else if (alias.kind === 'decision') {
      const decision = collectionDecisions(m).find((d) => d.id === alias.id && d.rev === alias.rev);
      if (decision)
        segments.push({
          id: alias.alias,
          rev: alias.rev,
          text: `Recorded decision: ${decision.statement}\nScope: ${decision.scope}\nParticipants: ${decision.participants}\n${decision.basis}`,
          kind: 'manual',
          version: 1,
        } as Segment);
      // Virtual validator evidence only. The real meeting's transcript is never changed.
      continue;
    } else if (alias.kind === 'object') {
      const found =
        m.objects.find((o) => o.id === alias.id && o.rev === alias.rev) ??
        m.objectHistory?.find((o) => o.id === alias.id && o.rev === alias.rev);
      if (found) objects.push({ ...found, id: alias.alias });
    } else {
      const found = m.relations.find((r) => r.id === alias.id && r.rev === alias.rev);
      if (found) relations.push({ ...found, id: alias.alias });
    }
  }
  return {
    id: 'collection',
    title: '',
    timezone: 'UTC',
    createdAt: '',
    endedAt: null,
    status: 'ended',
    mode: 'manual',
    capture: 'stopped',
    epoch: 0,
    revision: 1,
    inputVersion: 1,
    understoodVersion: 1,
    languageRevision: 1,
    outputLocale: 'en',
    segments,
    translations: [],
    inputGaps: [],
    objects,
    relations,
    artifacts: [],
    scenarios: [],
    decisions: [],
    toolObservations: [],
    processedSources: {},
    focus: '',
    changes: [],
    processing: 'idle',
    error: null,
    captureError: null,
    metrics: { calls: 0, inputTokens: 0, outputTokens: 0, lastLatencyMs: 0 },
  } as unknown as Meeting;
}

/**
 * Deterministic post-checks that cannot be expressed in the schema. The first is
 * the one that matters: a report that quietly drops a disagreement would be
 * worse than no report, because it would look complete.
 */
export function assertCollectionCoverage(report: CollectionReport, digest: CollectionDigest): void {
  const acc: Citations = { sources: [], objects: [], relations: [] };
  collect(report, 'report', acc);
  const cited = new Set<string>([
    ...acc.sources.map(([r]) => r.id),
    ...acc.objects.map(([id]) => id),
  ]);
  for (const dispute of digest.disputes)
    for (const position of dispute.positions)
      if (!cited.has(position.alias)) throw new Error('COLLECTION_DISPUTE_OMITTED');
}
