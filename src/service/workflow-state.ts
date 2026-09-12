import { createHash, randomUUID } from 'node:crypto';
import type { Meeting, Proposal, Ref, ExpressionJob } from '../contracts/model';

import type { ReadSet, WorkflowJob } from '../contracts/workflow';
export type { ReadSet, WorkflowJob } from '../contracts/workflow';
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function readSet(m: Meeting): ReadSet {
  const refs = (items: Ref[]) => items.map(({ id, rev }) => ({ id, rev }));
  return {
    sources: refs(m.segments),
    objects: [
      ...refs(m.objects),
      ...((m.contextIndex?.objects as Ref[]) ?? []).map(({ id, rev }) => ({ id, rev })),
    ],
    relations: refs(m.relations),
    artifacts: [
      ...refs(m.artifacts),
      ...((m.contextIndex?.artifacts as Ref[]) ?? []).map(({ id, rev }) => ({ id, rev })),
    ],
    languageRevision: m.languageRevision,
    titleRevision: m.titleMeta?.revision ?? 0,
  };
}
export function readsValid(read: ReadSet, m: Meeting) {
  const valid = (refs: Ref[], items: Ref[]) =>
    refs.every(
      (r) =>
        items.some((x) => x.id === r.id && x.rev === r.rev) &&
        !items.some((x) => x.id === r.id && x.rev > r.rev),
    );
  return (
    read.languageRevision === m.languageRevision &&
    read.titleRevision === (m.titleMeta?.revision ?? 0) &&
    valid(read.sources, m.segments) &&
    valid(read.objects, m.objects) &&
    valid(read.relations, m.relations) &&
    valid(read.artifacts, m.artifacts) &&
    (read.historical ?? []).every((r) => {
      const items =
        r.kind === 'source'
          ? m.segments
          : r.kind === 'object'
            ? [...m.objects, ...(m.objectHistory ?? [])]
            : r.kind === 'artifact'
              ? m.artifacts
              : m.relations;
      return items.some((x) => x.id === r.id && x.rev === r.rev);
    })
  );
}
export function assertLease(job: WorkflowJob, fence: number) {
  if (
    job.fence !== fence ||
    job.leaseUntil < Date.now() ||
    !['running', 'proposed'].includes(job.status)
  )
    throw new Error('JOB_FENCED');
}
/** Every new definition gets a host ID; legacy proposal IDs are treated as local aliases. */
export function resolveNewRefs(
  proposal: Proposal,
  m: Meeting,
): { proposal: Proposal; idMap: Record<string, string> } {
  const p = structuredClone(proposal),
    idMap: Record<string, string> = {};
  const definitions = [...p.objects, ...p.relations];
  if (new Set(definitions.map((x) => x.id)).size !== definitions.length)
    throw new Error('DUPLICATE_DEFINITION');
  const knownIds = new Set([...m.objects, ...m.relations].map((x) => x.id));
  if (
    p.objects.some((o) => m.relations.some((r) => r.id === o.id)) ||
    p.relations.some((r) => m.objects.some((o) => o.id === r.id))
  )
    throw new Error('ID_KIND_MISMATCH');
  for (const x of definitions) if (!knownIds.has(x.id)) idMap[x.id] = randomUUID();
  const objectRef = (id: string) => {
    if (id.startsWith('new_') && !idMap[id] && !knownIds.has(id))
      throw new Error('UNKNOWN_NEW_REF');
    return idMap[id] ?? id;
  };
  for (const o of p.objects) {
    o.id = objectRef(o.id);
    if (o.meaning) o.meaning.conditionIds = o.meaning.conditionIds.map(objectRef);
  }
  for (const r of p.relations) {
    r.id = objectRef(r.id);
    r.from = objectRef(r.from);
    r.to = objectRef(r.to);
  }
  const blocks = [...(p.artifact?.blocks ?? []), ...(p.patch?.upsertBlocks ?? [])];
  for (const block of blocks) {
    block.objectIds = block.objectIds.map(objectRef);
    if (block.type === 'diagram') {
      for (const node of block.nodes) node.objectId = objectRef(node.objectId);
      for (const edge of block.edges) edge.relationId = objectRef(edge.relationId);
    }
  }
  if (p.artifact) p.artifact.objectIds = p.artifact.objectIds.map(objectRef);
  if (p.plan) p.plan.objectIds = p.plan.objectIds.map(objectRef);
  for (const intent of p.collaborationIntents ?? [])
    intent.objectRefs = intent.objectRefs.map((ref) => ({ ...ref, id: objectRef(ref.id) }));
  if (p.clarification) {
    p.clarification.candidates = p.clarification.candidates.map((r) => ({
      ...r,
      id: objectRef(r.id),
    }));
    p.clarification.affectedObjectIds = p.clarification.affectedObjectIds.map(objectRef);
  }
  return { proposal: p, idMap };
}
export function expressionIdentity(
  job: Pick<ExpressionJob, 'scope' | 'branchId' | 'plan' | 'artifact'>,
) {
  return JSON.stringify([
    job.scope,
    job.branchId ?? '',
    job.plan?.purposeKey ?? job.artifact?.purposeKey,
    job.plan?.objectIds ?? job.artifact?.objectIds ?? [],
  ]);
}

export function makeWorkflowJob(
  context: Meeting,
  accepted: Ref[],
  requestId?: string,
): WorkflowJob {
  const frozen = structuredClone(context);
  delete frozen.workflowJobs;
  delete frozen.failedExpression;
  frozen.calls = [];
  frozen.expressionJobs = [];
  const scope = requestId ? 'personal' : 'meeting';
  return {
    id: randomUUID(),
    hash: digest({ accepted, language: frozen.languageRevision, scope, requestId }),
    scope,
    requestId,
    accepted,
    context: frozen,
    readSet: readSet(frozen),
    status: 'pending',
    fence: 0,
    leaseUntil: 0,
    attempts: 0,
    modelCalls: 0,
    toolCalls: 0,
    observations: [],
    createdAt: new Date().toISOString(),
  };
}

/** Historical records are immutable reads, guarded separately from the observed current head. */
export function addEvidenceRead(
  read: ReadSet,
  ref: { kind: string; id: string; rev: number },
  observed: Meeting,
) {
  if (!['source', 'object', 'artifact', 'relation'].includes(ref.kind))
    throw new Error('UNKNOWN_EVIDENCE_KIND');
  const items =
    ref.kind === 'source'
      ? observed.segments
      : ref.kind === 'object'
        ? observed.objects
        : ref.kind === 'artifact'
          ? observed.artifacts
          : observed.relations;
  const head = items
    .filter((x) => x.id === ref.id)
    .reduce<Ref | undefined>(
      (latest, x) => (!latest || x.rev > latest.rev ? x : latest),
      undefined,
    );
  if (!head) throw new Error('EVIDENCE_HEAD_MISSING');
  const target =
    ref.kind === 'source'
      ? read.sources
      : ref.kind === 'object'
        ? read.objects
        : ref.kind === 'artifact'
          ? read.artifacts
          : read.relations;
  if (!target.some((x) => x.id === head.id && x.rev === head.rev))
    target.push({ id: head.id, rev: head.rev });
  if (head.rev !== ref.rev) {
    read.historical ??= [];
    if (!read.historical.some((x) => x.kind === ref.kind && x.id === ref.id && x.rev === ref.rev))
      read.historical.push({
        ...ref,
        kind: ref.kind as 'source' | 'object' | 'artifact' | 'relation',
      });
  }
}
