import { z } from 'zod';
import type { Meeting, Proposal, Ref } from './model';
export type ReadSet = {
  sources: Ref[];
  objects: Ref[];
  relations: Ref[];
  artifacts: Ref[];
  historical?: Array<Ref & { kind: 'source' | 'object' | 'artifact' | 'relation' }>;
  languageRevision: number;
  titleRevision: number;
};
export type WorkflowJob = {
  id: string;
  hash: string;
  scope: 'meeting' | 'personal';
  requestId?: string;
  accepted: Ref[];
  context: Meeting;
  readSet: ReadSet;
  status:
    | 'pending'
    | 'running'
    | 'proposed'
    | 'succeeded'
    | 'failed'
    | 'rejected'
    | 'cancelled'
    | 'superseded';
  fence: number;
  leaseUntil: number;
  attempts: number;
  modelCalls: number;
  toolCalls: number;
  cancelled?: boolean;
  expressionState?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  expressionError?: string;
  proposal?: Proposal;
  proposalHash?: string;
  idMap?: Record<string, string>;
  observations: unknown[];
  error?: string;
  createdAt: string;
};

export const EvidenceRequest = z
  .object({
    kind: z.enum([
      'search_meeting',
      'read_sources',
      'neighbors',
      'dependency_impact',
      'read_objects',
      'read_artifacts',
      'calculate',
    ]),
    query: z.string().max(300),
    refs: z
      .array(z.object({ id: z.string().max(100), rev: z.number().int().positive() }).strict())
      .max(20),
    cursor: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(20),
    formulaId: z.string().max(100),
    overrides: z.record(z.string(), z.number().nullable()),
  })
  .strict();
export type EvidenceRequest = z.infer<typeof EvidenceRequest>;
