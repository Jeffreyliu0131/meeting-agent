import { z } from 'zod';

const id = z.string().min(1).max(100);
export const IntentRef = z.object({ id, rev: z.number().int().positive() }).strict();
const refs = z.array(IntentRef).max(30);
const text = z.string().max(500);
export const IntentFamily = z.enum(['poll', 'assignment', 'conflict', 'decision_confirmation']);
export const DraftContent = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('poll'),
      question: text,
      options: z
        .array(z.object({ key: id.regex(/^[a-zA-Z0-9_-]+$/), label: text, sources: refs }).strict())
        .max(12),
      selection: z.enum(['single', 'multiple']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('assignment'),
      items: z
        .array(
          z
            .object({
              key: id.regex(/^[a-zA-Z0-9_-]+$/),
              task: text,
              deliverable: text,
              owner: text.nullable(),
              time: text.nullable(),
              dependencies: refs,
              sources: refs,
            })
            .strict(),
        )
        .max(30),
    })
    .strict(),
  z
    .object({
      kind: z.literal('conflict'),
      summary: text,
      sides: z
        .array(
          z
            .object({ key: id.regex(/^[a-zA-Z0-9_-]+$/), description: text, sources: refs })
            .strict(),
        )
        .max(4),
      questions: z.array(text).max(6),
      resolutions: z.array(text).max(4),
    })
    .strict(),
  z
    .object({
      kind: z.literal('decision_confirmation'),
      statement: text,
      scopeText: text,
      conditions: z.array(text).max(12),
    })
    .strict(),
]);
export const IntentCandidate = z
  .object({
    localId: id,
    family: IntentFamily,
    operation: z.enum([
      'prepare',
      'update',
      'preview',
      'publish',
      'respond',
      'close',
      'cancel',
      'propose_resolution',
      'apply_resolution',
      'record_decision',
    ]),
    expression: z.enum(['explicit', 'suggested', 'negated', 'hypothetical', 'quoted']),
    resolution: z.enum([
      'actionable_draft',
      'suggestion',
      'needs_clarification',
      'no_action',
      'unsupported',
    ]),
    target: IntentRef.nullable(),
    targetLocalId: id.nullable(),
    topicRef: IntentRef.nullable(),
    referencedObjects: refs,
    evidence: refs,
    collectionMode: z.enum(['retrospective', 'prospective', 'none']),
    scopeText: text,
    missingSlots: z.array(text).max(12),
    dependsOnLocalIds: z.array(id).max(4),
    content: DraftContent.nullable(),
  })
  .strict();
export const CollaborationProposal = z
  .object({
    intents: z.array(IntentCandidate).max(4),
    coverage: z.enum(['complete', 'partial']),
    unprocessedRefs: refs,
  })
  .strict();
export type IntentCandidate = z.infer<typeof IntentCandidate>;
export type DraftContent = z.infer<typeof DraftContent>;
export type CollaborationProposal = z.infer<typeof CollaborationProposal>;
export type IntentDraft = {
  id: string;
  rev: number;
  purposeKey: string;
  candidate: IntentCandidate;
  status: 'suggestion' | 'collecting' | 'draft' | 'needs_clarification' | 'dismissed';
  content: DraftContent | null;
  sources: z.infer<typeof IntentRef>[];
  manualLocks: string[];
  tombstones: string[];
  suggestedContent: DraftContent | null;
  needsReview: boolean;
  missingFields: string[];
  consumedRefs: z.infer<typeof IntentRef>[];
  startVersion: number;
  freezeRefs: z.infer<typeof IntentRef>[] | null;
  history: Array<{
    rev: number;
    content: DraftContent | null;
    sources: z.infer<typeof IntentRef>[];
  }>;
};
export type IntentPreparationState = {
  enabled: boolean;
  revision: number;
  drafts: IntentDraft[];
  processedEvents: string[];
  coverage: 'complete' | 'partial';
  unprocessedRefs: z.infer<typeof IntentRef>[];
};
