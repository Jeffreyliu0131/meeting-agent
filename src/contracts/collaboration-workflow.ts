import { z } from 'zod';
import { ComponentContent, Family, EvidenceRef } from './collaboration';
const ref = z.object({ id: z.string().min(1).max(100), rev: z.number().int().positive() }).strict();
export const CollaborationIntent = z
  .object({
    family: Family,
    operation: z.enum(['prepare', 'update', 'preview', 'publish', 'close', 'cancel']),
    expression: z.enum(['explicit', 'suggested', 'negated', 'hypothetical', 'quoted']),
    resolution: z.enum(['actionable_draft', 'suggestion', 'needs_clarification', 'no_action']),
    targetId: z.string().max(100).nullable(),
    scopeText: z.string().max(500),
    collectionMode: z.enum(['retrospective', 'prospective', 'none']),
    sourceRefs: z.array(ref).min(1).max(20),
    objectRefs: z.array(ref).max(30),
  })
  .strict();
export type CollaborationIntent = z.infer<typeof CollaborationIntent>;
export const ComponentProposal = z
  .object({
    content: ComponentContent.nullable(),
    clarification: z.string().min(1).max(500).nullable(),
  })
  .strict();
export type ComponentProposal = z.infer<typeof ComponentProposal>;
export const ImpactProposal = z
  .object({
    conflicts: z
      .array(
        z
          .object({
            type: z.enum(['assignment_mismatch', 'constraint_violation', 'participant_objection']),
            summary: z.string().min(1).max(500),
            impact: z.string().max(500),
            objectRefs: z.array(ref).max(30),
            evidence: z.array(EvidenceRef).min(1).max(30),
            affectedParticipantIds: z.array(z.string().max(100)).max(10),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();
export type ImpactProposal = z.infer<typeof ImpactProposal>;
