import type { Closeout, Meeting } from '../contracts/model';
import { artifactIsStale } from './artifacts';
import { refsCurrent } from './meaning';

/** Whole saved state is checked, not the last model context window. No new facts are inferred. */
export function reconcileCloseout(m: Meeting): Closeout | undefined {
  if (m.status !== 'ended') return undefined;
  const latest = new Map(m.segments.map((s) => [s.id, s]));
  for (const s of m.segments) if (s.rev > latest.get(s.id)!.rev) latest.set(s.id, s);
  const pendingSources = [...latest.values()]
    .filter((s) => m.processedSources?.[s.id] !== s.rev)
    .map((s) => ({ id: s.id, rev: s.rev }));
  const active = m.objects.filter((o) => o.lifecycle === 'active');
  const reviewObjectIds = active.filter((o) => o.reviewRequired).map((o) => o.id);
  const unresolvedObjectIds = active
    .filter((o) => o.kind === 'question' || o.status === 'disputed' || o.status === 'unknown')
    .map((o) => o.id);
  const conditionalObjectIds = active
    .filter((o) => o.meaning?.conditionIds.length || o.meaning?.stance === 'conditional')
    .map((o) => o.id);
  const incompleteTaskIds = active
    .filter(
      (o) =>
        o.kind === 'task' &&
        (!o.meaning?.owner || !o.meaning.deadline || o.meaning.stance !== 'committed'),
    )
    .map((o) => o.id);
  const provisionalObjectIds = active
    .filter((o) => o.kind !== 'topic' && (!o.meaning || o.meaning.stance === 'unknown'))
    .map((o) => o.id);
  const staleDecisionIds = m.decisions
    .filter(
      (d) =>
        d.scope === 'meeting' && (!refsCurrent(d.sources, m) || artifactIsStale(d.artifact, m)),
    )
    .map((d) => d.id);
  const latestArtifacts = new Map(
    m.artifacts.filter((a) => (a.scope ?? 'meeting') === 'meeting').map((a) => [a.id, a]),
  );
  const staleArtifactIds = [...latestArtifacts.values()]
    .filter((a) => artifactIsStale(a, m))
    .map((a) => a.id);
  const working =
    (m.audioPending ?? 0) > 0 ||
    m.processing === 'working' ||
    m.expressionStatus === 'working' ||
    !!m.expressionJobs?.length;
  const issues =
    pendingSources.length ||
    m.inputGaps.length ||
    reviewObjectIds.length ||
    unresolvedObjectIds.length ||
    conditionalObjectIds.length ||
    incompleteTaskIds.length ||
    provisionalObjectIds.length ||
    staleDecisionIds.length ||
    staleArtifactIds.length ||
    m.error ||
    m.expressionError;
  return {
    inputVersion: m.inputVersion,
    state:
      working || (pendingSources.length > 0 && m.processing !== 'error')
        ? 'pending'
        : issues
          ? 'needs_review'
          : 'ready',
    pendingSources,
    reviewObjectIds,
    unresolvedObjectIds,
    conditionalObjectIds,
    incompleteTaskIds,
    provisionalObjectIds,
    staleDecisionIds,
    staleArtifactIds,
    gapCount: m.inputGaps.length,
  };
}
