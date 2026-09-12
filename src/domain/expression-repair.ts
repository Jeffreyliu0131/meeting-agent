import type { Artifact } from '../contracts/model';
/** Repairs may change geometry, but cannot rewrite the submitted content or bindings. */
export function validatePresentationRepair(before: Artifact, after: Artifact) {
  const content = (a: Artifact) => ({
    id: a.id,
    purposeKey: a.purposeKey,
    question: a.question,
    summary: a.summary,
    objectIds: a.objectIds,
    sources: a.sources,
    formulas: a.formulas,
    blocks: a.blocks.map((b) =>
      b.type === 'svg' || b.type === 'html'
        ? {
            ...b,
            markup: b.markup
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
          }
        : b,
    ),
  });
  if (JSON.stringify(content(before)) !== JSON.stringify(content(after)))
    throw new Error('REPAIR_CHANGED_CONTENT');
}
