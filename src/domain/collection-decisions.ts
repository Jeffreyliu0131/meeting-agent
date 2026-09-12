import type { Meeting } from '../contracts/model';
/** Recorded business evidence, never a fabricated transcript or semantic object. */
export function collectionDecisions(m: Meeting) {
  const old = m.decisions
    .filter((d) => d.scope === 'meeting')
    .map((d) => ({
      id: d.id,
      rev: 1,
      statement: d.artifact?.summary || d.artifact?.question || '',
      scope: d.artifact?.question || '',
      basis: d.basis,
      participants: d.participants,
      sources: d.sources,
      reviewRequired: false,
    }));
  const collaboration = (m.collaboration?.decisions ?? []).map((d) => {
    const component = m.collaboration!.components.find((c) => c.id === d.componentId);
    const round = component?.rounds.find((r) => r.revision === d.revision);
    return {
      id: 'collaboration:' + d.id,
      rev: d.revision,
      statement: d.statement,
      scope: round?.content.kind === 'decision_confirmation' ? round.content.payload.scopeText : '',
      basis: d.reviewRequired
        ? 'Recorded scoped decision; new issue requires review.'
        : 'Explicit participant agreement recorded by the host (local simulation).',
      participants: d.participantIds
        .map((id) => m.collaboration!.participants.find((p) => p.id === id)?.displayName ?? id)
        .join(', '),
      sources: (round?.sharedEvidence ?? []).flatMap((e) =>
        e.sourceRef.kind === 'segment' ? [e.sourceRef.ref] : [],
      ),
      reviewRequired: d.reviewRequired,
    };
  });
  return [...old, ...collaboration];
}
