import { z } from 'zod';

const id = z.string().min(1).max(100);
const text = z.string().max(1000);
const ref = z.object({ id, rev: z.number().int().positive() }).strict();
export const EvidenceRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('segment'), ref }).strict(),
  z.object({ kind: z.literal('command'), commandId: id }).strict(),
  z
    .object({
      kind: z.literal('response'),
      responseId: id,
      responseVersion: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal('rule_result'), resultId: id }).strict(),
  z
    .object({
      kind: z.literal('component_result'),
      componentId: id,
      publishedRevision: z.number().int().positive(),
    })
    .strict(),
]);
export type EvidenceRef = z.infer<typeof EvidenceRef>;
const evidence = z.array(EvidenceRef).max(100);
export const Family = z.enum(['poll', 'assignment', 'conflict', 'decision_confirmation']);
export type Family = z.infer<typeof Family>;
export const Schedule = z
  .object({
    rawText: text,
    timezone: z.string().max(100).nullable(),
    start: z.string().datetime().nullable(),
    end: z.string().datetime().nullable(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    dueAt: z.string().datetime().nullable(),
    precision: z.enum(['interval', 'datetime', 'date', 'unknown']),
    exclusive: z.boolean().nullable(),
  })
  .strict();
const task = z
  .object({
    id,
    itemRevision: z.number().int().positive(),
    taskRef: ref.nullable(),
    title: text,
    deliverable: text,
    assigneeId: id.nullable(),
    unresolvedAssigneeText: text.nullable(),
    collaboratorIds: z.array(id).max(10),
    schedule: Schedule,
    dependencyRefs: z.array(ref).max(30),
    discussionPoints: z.array(z.object({ id, text, sourceRefs: evidence }).strict()).max(12),
    conflictIds: z.array(id).max(30),
  })
  .strict();
const action = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('revise_task'),
      taskRef: ref,
      proposed: z
        .object({
          deliverable: text.optional(),
          assigneeId: id.optional(),
          scheduleText: text.optional(),
          dependencyRefs: z.array(ref).max(30).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('request_clarification'),
      question: text,
      participantIds: z.array(id).max(10),
    })
    .strict(),
  z
    .object({ kind: z.literal('prepare_poll'), question: text, labels: z.array(text).max(12) })
    .strict(),
]);
export const ComponentContent = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('poll'),
      payload: z
        .object({
          question: z.string().max(300),
          contextSummary: text,
          options: z
            .array(
              z
                .object({
                  id,
                  label: z.string().max(100),
                  description: z.string().max(500),
                  objectRefs: z.array(ref).max(30),
                })
                .strict(),
            )
            .max(12),
          selection: z
            .object({
              mode: z.enum(['single', 'multiple']),
              min: z.number().int().min(1),
              max: z.number().int().min(1).max(12),
            })
            .strict(),
          allowAbstain: z.boolean(),
          resultsVisibility: z.literal('after_close'),
          closePolicy: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('host') }).strict(),
            z.object({ kind: z.literal('deadline'), at: z.string().datetime() }).strict(),
          ]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('assignment'),
      payload: z
        .object({ mode: z.enum(['display', 'request_acceptance']), items: z.array(task).max(30) })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('conflict'),
      payload: z
        .object({
          conflictRefs: z.array(ref).max(12),
          sides: z
            .array(
              z
                .object({
                  id,
                  title: text,
                  description: text,
                  objectRefs: z.array(ref).max(30),
                  evidence,
                })
                .strict(),
            )
            .max(4),
          questions: z
            .array(z.object({ id, text, participantIds: z.array(id).max(10) }).strict())
            .max(6),
          resolutions: z
            .array(
              z
                .object({ id, title: text, tradeoffs: text, actions: z.array(action).max(6) })
                .strict(),
            )
            .max(4),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('decision_confirmation'),
      payload: z
        .object({
          statement: text,
          scopeText: z.string().max(500),
          conditions: z
            .array(z.object({ id, text, objectRefs: z.array(ref).max(30), evidence }).strict())
            .max(12),
          targetObjectRefs: z.array(ref).max(30),
          supportingResults: z
            .array(
              z
                .object({ componentId: id, publishedRevision: z.number().int().positive() })
                .strict(),
            )
            .max(12),
          requiredParticipantIds: z.array(id).max(10),
          rule: z.literal('all_required_explicit_agree'),
        })
        .strict(),
    })
    .strict(),
]);
export type ComponentContent = z.infer<typeof ComponentContent>;
export const ComponentResponse = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vote'), optionIds: z.array(id).min(1).max(12) }).strict(),
  z.object({ kind: z.literal('abstain') }).strict(),
  z.object({ kind: z.literal('agree') }).strict(),
  z.object({ kind: z.literal('reserve'), reason: text.min(1) }).strict(),
  z.object({ kind: z.literal('disagree'), reason: text.min(1) }).strict(),
  z
    .object({ kind: z.literal('accept'), itemId: id, itemRevision: z.number().int().positive() })
    .strict(),
  z
    .object({
      kind: z.literal('object'),
      itemId: id,
      itemRevision: z.number().int().positive(),
      reason: text.min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('suggest_change'),
      itemId: id,
      itemRevision: z.number().int().positive(),
      reason: text.min(1),
      suggestion: z
        .object({
          deliverable: text.optional(),
          scheduleText: text.optional(),
          assigneeId: id.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('report_issue'),
      itemId: id,
      itemRevision: z.number().int().positive(),
      reason: text.min(1),
      commentId: id,
    })
    .strict(),
  z
    .object({
      kind: z.literal('provide_context'),
      questionId: id.nullable(),
      commentId: id,
      text: text.min(1),
    })
    .strict(),
  z.object({ kind: z.literal('support_resolution'), resolutionId: id }).strict(),
  z.object({ kind: z.literal('suggest_resolution'), commentId: id, text: text.min(1) }).strict(),
]);
export type ComponentResponse = z.infer<typeof ComponentResponse>;
export const CollaborationCommand = z
  .object({
    id,
    meetingId: id,
    type: z.enum([
      'component.prepare',
      'component.edit_draft',
      'component.freeze_collection',
      'component.publish',
      'component.respond',
      'component.close',
      'component.cancel',
      'component.record_decision',
      'component.apply_resolution',
      'component.resolve_report',
      'component.delivery_ack',
      'component.resolve_target',
      'component.revalidate_round',
      'component.report_new_issue',
    ]),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type CollaborationCommand = z.infer<typeof CollaborationCommand>;
export type Participant = {
  id: string;
  meetingId: string;
  displayName: string;
  role: 'host' | 'participant';
  identityBasis: 'local_simulation';
  active: boolean;
};
export type ComponentRevision = {
  revision: number;
  content: ComponentContent;
  sourceRefs: EvidenceRef[];
  objectRefs: z.infer<typeof ref>[];
  manualLocks: string[];
  createdAt: string;
  createdBy: string;
};
export type PublishedRound = {
  revision: number;
  content: ComponentContent;
  status: 'open' | 'closed' | 'cancelled' | 'superseded';
  audienceIds: string[];
  audienceSnapshot: { id: string; displayName: string }[];
  sharedEvidence: { sourceRef: EvidenceRef; excerpt: string; disclosedBy: string }[];
  publishedAt: string;
  closesAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  responseGate: 'open' | 'blocked';
  reviewReasons: string[];
  reviewedDependencies?: { sourceRefs: EvidenceRef[]; objectRefs: { id: string; rev: number }[] };
};
export type ResponseRecord = {
  id: string;
  componentId: string;
  publishedRevision: number;
  actorId: string;
  subject: string;
  version: number;
  response: ComponentResponse;
  at: string;
  resolved?: boolean;
};
export type Component = {
  id: string;
  meetingId: string;
  family: Family;
  topicRef: z.infer<typeof ref> | null;
  purposeKey: string;
  aggregateVersion: number;
  revisions: ComponentRevision[];
  draftRevision: number;
  draftState: 'draft' | 'collecting' | 'ready' | 'cancelled';
  publishedRevision: number | null;
  rounds: PublishedRound[];
  requiredAnalysisSequence: number;
  validatedAnalysisSequence: number;
  needsReview: boolean;
  missingFields: string[];
  collection: {
    scopeText: string;
    startAfter: number;
    consumedRefs: z.infer<typeof ref>[];
    excludedIds: string[];
    status: 'collecting' | 'freezing' | 'stopped';
    freezeWatermark: z.infer<typeof ref>[];
    coverage: 'complete' | 'partial';
  } | null;
};
export type ConflictRecord = {
  scope?: 'draft' | 'published';
  id: string;
  revision: number;
  fingerprint: string;
  type:
    | 'time_overlap'
    | 'dependency_conflict'
    | 'assignment_mismatch'
    | 'constraint_violation'
    | 'participant_objection';
  basis: 'rule' | 'agent_inferred' | 'participant_reported';
  verification: 'supported' | 'needs_confirmation' | 'dismissed';
  resolution: 'unresolved' | 'proposed' | 'awaiting_revision' | 'resolved';
  summary: string;
  impact: string;
  objectRefs: z.infer<typeof ref>[];
  evidence: EvidenceRef[];
  affectedParticipantIds: string[];
  coverage: 'complete' | 'partial';
  componentIds: string[];
};
export type CollaborationEvent = {
  id: string;
  sequence: number;
  type: string;
  componentId: string | null;
  actorId: string;
  at: string;
  payload: unknown;
  rootEventId: string;
};
export type CollaborationJob = {
  id: string;
  kind: 'component' | 'impact';
  rootEventId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'superseded';
  modelCalls: number;
  fence: number;
  accepted: z.infer<typeof ref>[];
  componentId: string | null;
  baseRevision: number | null;
  input: unknown;
  proposal?: unknown;
  error?: string;
};
export type CollaborationState = {
  evaluationFrontiers?: {
    commandId: string;
    hash: string;
    sourceRefs: { id: string; rev: number }[];
  }[];
  schemaVersion: 1;
  meetingId: string;
  ended: boolean;
  sequence: number;
  participants: Participant[];
  components: Component[];
  responses: ResponseRecord[];
  conflicts: ConflictRecord[];
  events: CollaborationEvent[];
  jobs: CollaborationJob[];
  receipts: {
    eventId: string;
    participantId: string;
    deliveredAt: string;
    viewedAt: string | null;
  }[];
  decisions: {
    id: string;
    componentId: string;
    revision: number;
    statement: string;
    participantIds: string[];
    responseIds: string[];
    at: string;
    reviewRequired: boolean;
  }[];
  processedSources: Record<string, number>;
  ignoredPurposes: string[];
};
export type ComponentView = {
  id: string;
  family: Family;
  aggregateVersion: number;
  draftRevision?: number;
  draftState?: Component['draftState'];
  draft?: ComponentRevision;
  round: PublishedRound | null;
  responded: number;
  ownResponses: ResponseRecord[];
  statuses: { participantId: string; subject: string; kind: string }[];
  responses?: ResponseRecord[];
  result: Record<string, unknown> | null;
  missingFields: string[];
  needsReview: boolean;
};
export type CollaborationSnapshot = {
  meetingId: string;
  actor: Participant;
  participants: Participant[];
  components: ComponentView[];
  sequence: number;
  ended: boolean;
  conflicts?: ConflictRecord[];
  jobs?: CollaborationJob[];
  notices?: CollaborationEvent[];
  assignmentDirectory?: Extract<ComponentContent, { kind: 'assignment' }>['payload']['items'];
  evidenceCatalog?: { sourceRef: EvidenceRef; excerpt: string }[];
  decisions: CollaborationState['decisions'];
};

export function emptyContent(kind: Family): ComponentContent {
  if (kind === 'poll')
    return {
      kind,
      payload: {
        question: '',
        contextSummary: '',
        options: [],
        selection: { mode: 'single', min: 1, max: 1 },
        allowAbstain: true,
        resultsVisibility: 'after_close',
        closePolicy: { kind: 'host' },
      },
    };
  if (kind === 'assignment') return { kind, payload: { mode: 'display', items: [] } };
  if (kind === 'conflict')
    return { kind, payload: { conflictRefs: [], sides: [], questions: [], resolutions: [] } };
  return {
    kind,
    payload: {
      statement: '',
      scopeText: '',
      conditions: [],
      targetObjectRefs: [],
      supportingResults: [],
      requiredParticipantIds: [],
      rule: 'all_required_explicit_agree',
    },
  };
}
