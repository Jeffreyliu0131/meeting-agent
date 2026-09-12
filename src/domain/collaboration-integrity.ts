import type { Meeting } from '../contracts/model';
import type { ComponentRevision, EvidenceRef } from '../contracts/collaboration';
import { contentEvidence, findRound, addCollaborationEvent } from './collaboration';

export function collaborationDependenciesCurrent(
  m: Meeting,
  revision: Pick<ComponentRevision, 'sourceRefs' | 'objectRefs'>,
) {
  const evidenceCurrent = (e: EvidenceRef): boolean => {
    if (e.kind === 'segment')
      return (
        m.segments.some((s) => s.id === e.ref.id && s.rev === e.ref.rev && s.kind !== 'request') &&
        !m.segments.some((s) => s.id === e.ref.id && s.rev > e.ref.rev)
      );
    if (e.kind === 'response') {
      const response = m.collaboration?.responses.find(
        (r) => r.id === e.responseId && r.version === e.responseVersion,
      );
      return (
        !!response &&
        !response.resolved &&
        !m.collaboration!.responses.some(
          (r) =>
            r.componentId === response.componentId &&
            r.publishedRevision === response.publishedRevision &&
            r.actorId === response.actorId &&
            r.subject === response.subject &&
            r.version > response.version,
        )
      );
    }
    if (e.kind === 'component_result')
      return !!m.collaboration?.components.some(
        (c) =>
          c.id === e.componentId &&
          c.publishedRevision === e.publishedRevision &&
          c.rounds.some(
            (r) =>
              r.revision === e.publishedRevision &&
              r.status === 'closed' &&
              r.responseGate === 'open',
          ),
      );
    return true;
  };
  return (
    revision.sourceRefs.every(evidenceCurrent) &&
    revision.objectRefs.every((ref) => m.objects.some((o) => o.id === ref.id && o.rev === ref.rev))
  );
}

export function refreshCollaborationIntegrity(m: Meeting) {
  const s = m.collaboration;
  if (!s) return;
  for (const c of s.components) {
    const draft = c.revisions.at(-1)!;
    const contentRefs =
      draft.content.kind === 'decision_confirmation' ? draft.content.payload.targetObjectRefs : [];
    const valid = collaborationDependenciesCurrent(m, {
      sourceRefs: [...draft.sourceRefs, ...contentEvidence(draft.content)],
      objectRefs: [...draft.objectRefs, ...contentRefs],
    });
    const wasStale = c.needsReview;
    c.needsReview = !valid || s.decisions.some((d) => d.componentId === c.id && d.reviewRequired);
    const round = findRound(c);
    if (round) {
      const published = c.revisions.find((r) => r.revision === round.revision)!;
      const dependencies = round.reviewedDependencies ?? {
        sourceRefs: [...published.sourceRefs, ...contentEvidence(round.content)],
        objectRefs: [
          ...published.objectRefs,
          ...(round.content.kind === 'decision_confirmation'
            ? round.content.payload.targetObjectRefs
            : []),
        ],
      };
      if (!collaborationDependenciesCurrent(m, dependencies)) {
        if (round.responseGate !== 'blocked') {
          round.responseGate = 'blocked';
          round.reviewReasons = ['DEPENDENCY_STALE'];
          c.aggregateVersion++;
        }
        for (const decision of s.decisions.filter((d) => d.componentId === c.id))
          decision.reviewRequired = true;
      }
    }
    if (c.needsReview && !wasStale)
      addCollaborationEvent(s, 'component.review_required', 'system', c.id, {
        reason: 'DEPENDENCY_STALE',
      });
    if (c.needsReview && c.draftState === 'ready') c.draftState = 'draft';
  }
}
