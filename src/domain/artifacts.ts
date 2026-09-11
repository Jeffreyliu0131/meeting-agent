import {
  Artifact,
  type ArtifactPatch,
  type ArtifactRevision,
  type Meeting,
  type Ref,
} from '../contracts/model';
const uniqueRefs = (refs: Ref[]) => [...new Map(refs.map((r) => [r.id + ':' + r.rev, r])).values()];
export function applyArtifactPatch(base: ArtifactRevision, patch: ArtifactPatch): Artifact {
  if (base.id !== patch.artifactId || base.rev !== patch.baseRev)
    throw new Error('ARTIFACT_CONFLICT');
  if (
    new Set(patch.upsertBlocks.map((b) => b.id)).size !== patch.upsertBlocks.length ||
    patch.upsertBlocks.some((b) => patch.removeBlockIds.includes(b.id))
  )
    throw new Error('INVALID_PATCH');
  if (patch.removeBlockIds.some((id) => !base.blocks.some((b) => b.id === id)))
    throw new Error('INVALID_PATCH');
  const blocks = base.blocks.filter((b) => !patch.removeBlockIds.includes(b.id));
  for (const b of patch.upsertBlocks) {
    const i = blocks.findIndex((x) => x.id === b.id);
    if (i < 0) blocks.push(b);
    else blocks[i] = b;
  }
  const formulas = patch.formulas ?? base.formulas;
  return Artifact.parse({
    id: base.id,
    purposeKey: base.purposeKey,
    question: patch.question ?? base.question,
    summary: patch.summary ?? base.summary,
    layout: base.layout,
    blocks,
    formulas,
    objectIds: [...new Set(blocks.flatMap((b) => b.objectIds))],
    sources: uniqueRefs([
      ...blocks.flatMap((b) => b.sources),
      ...formulas.flatMap((f) => f.sources),
    ]),
  });
}
export function artifactIsStale(a: ArtifactRevision, m: Meeting) {
  return (
    a.languageRevision !== m.languageRevision ||
    a.sources.some((r) => m.segments.some((s) => s.id === r.id && s.rev > r.rev)) ||
    a.objectRefs.some((r) => m.objects.some((o) => o.id === r.id && o.rev !== r.rev)) ||
    (a.relationRefs ?? []).some((r) => m.relations.some((o) => o.id === r.id && o.rev !== r.rev))
  );
}
export function changedBlocks(previous: ArtifactRevision | undefined, next: Artifact) {
  return next.blocks
    .filter(
      (b) => JSON.stringify(previous?.blocks.find((x) => x.id === b.id)) !== JSON.stringify(b),
    )
    .map((b) => b.id);
}
