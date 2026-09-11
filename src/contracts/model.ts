import { z } from 'zod';
export const Locale = z.enum(['en', 'zh-CN']);
export type Locale = z.infer<typeof Locale>;
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const Ref = z.object({ id, rev: z.number().int().positive() }).strict();
export type Ref = z.infer<typeof Ref>;
const refs = z.array(Ref).max(50);
export const Provenance = z.enum(['stated', 'agent_inferred', 'user_entered', 'tool_computed']);
export const Status = z.enum(['unverified', 'assumed', 'disputed', 'unknown']);
export const SemanticObject = z
  .object({
    id,
    kind: z.enum([
      'topic',
      'claim',
      'option',
      'constraint',
      'risk',
      'question',
      'task',
      'milestone',
    ]),
    title: z.string().max(180),
    detail: z.string().max(700),
    origin: Provenance,
    status: Status,
    sources: refs,
    lifecycle: z.enum(['active', 'superseded', 'archived']),
  })
  .strict();
export const Relation = z
  .object({
    id,
    from: id,
    to: id,
    kind: z.enum([
      'depends_on',
      'supports',
      'challenges',
      'conditions',
      'part_of',
      'alternative_to',
      'supersedes',
    ]),
    sources: refs,
    origin: Provenance,
  })
  .strict();
const base = {
  id,
  title: z.string().max(180),
  sources: refs,
  objectIds: z.array(id).max(30),
  origin: Provenance,
  status: Status,
};
const text = z
  .object({ ...base, type: z.literal('text'), items: z.array(z.string().max(650)).min(1).max(12) })
  .strict();
const table = z
  .object({
    ...base,
    type: z.literal('table'),
    columns: z.array(z.string().max(100)).min(1).max(8),
    rows: z
      .array(z.object({ id, cells: z.array(z.string().max(350)).max(8), sources: refs }).strict())
      .max(20),
  })
  .strict();
const graph = z
  .object({
    ...base,
    type: z.literal('diagram'),
    nodes: z.array(z.object({ id, label: z.string().max(120), objectId: id }).strict()).max(16),
    edges: z
      .array(z.object({ from: id, to: id, relationId: id, label: z.string().max(100) }).strict())
      .max(24),
  })
  .strict();
const timeline = z
  .object({
    ...base,
    type: z.literal('timeline'),
    items: z
      .array(
        z
          .object({
            id,
            label: z.string().max(180),
            when: z.string().max(120),
            detail: z.string().max(250),
            sources: refs,
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
const chart = z
  .object({
    ...base,
    type: z.literal('chart'),
    unit: z.string().min(1).max(50),
    values: z
      .array(
        z
          .object({ label: z.string().max(100), value: z.number().finite(), sources: refs })
          .strict(),
      )
      .max(16),
  })
  .strict();
const markup = z
  .object({ ...base, type: z.enum(['svg', 'html']), markup: z.string().max(50000) })
  .strict();
const Expr: z.ZodType<Expression> = z.lazy(() =>
  z.union([
    z.object({ op: z.literal('value'), value: z.number().finite() }).strict(),
    z.object({ op: z.literal('param'), name: id }).strict(),
    z
      .object({ op: z.enum(['add', 'subtract', 'multiply', 'divide']), left: Expr, right: Expr })
      .strict(),
  ]),
);
export type Expression =
  | { op: 'value'; value: number }
  | { op: 'param'; name: string }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide'; left: Expression; right: Expression };
// A shallow arithmetic program avoids recursive JSON Schema provider differences.
export const Formula = z
  .object({
    id,
    label: z.string().max(120),
    unit: z.string().max(50),
    parameters: z
      .array(
        z
          .object({
            id,
            label: z.string().max(100),
            unit: z.string().max(50),
            value: z.number().finite().nullable(),
            min: z.number().finite(),
            max: z.number().finite(),
          })
          .strict(),
      )
      .max(12),
    steps: z
      .array(
        z
          .object({
            id,
            op: z.enum(['add', 'subtract', 'multiply', 'divide']),
            left: id,
            right: id,
          })
          .strict(),
      )
      .max(16),
    result: id,
    basis: z.string().min(1).max(500),
    sources: refs,
  })
  .strict();
export type Formula = z.infer<typeof Formula>;
export const Block = z.union([text, table, graph, timeline, chart, markup]);
export type Block = z.infer<typeof Block>;
export const Artifact = z
  .object({
    id,
    purposeKey: id,
    question: z.string().max(180),
    summary: z.string().max(350),
    layout: z.enum(['stack', 'columns']),
    objectIds: z.array(id).max(50),
    blocks: z.array(Block).min(1).max(6),
    formulas: z.array(Formula).max(3),
    sources: refs,
  })
  .strict();
export type Artifact = z.infer<typeof Artifact>;
export const Proposal = z
  .object({
    focus: z.string().max(180),
    changes: z.array(z.string().max(220)).max(3),
    objects: z.array(SemanticObject).max(60),
    relations: z.array(Relation).max(60),
    action: z.enum([
      'no_change',
      'patch_artifact',
      'create_artifact',
      'propose_restructure',
      'request_clarification',
    ]),
    artifact: Artifact.nullable(),
    rationale: z.string().max(400),
  })
  .strict();
export type Proposal = z.infer<typeof Proposal>;
export type Segment = {
  id: string;
  rev: number;
  text: string;
  kind: 'manual' | 'replay' | 'microphone' | 'system_audio' | 'request';
  epoch: number;
  channel: string;
  order: number;
  receivedAt: string;
  speaker: string | null;
  identity: 'unknown' | 'user_mapped';
  identityBasis: string | null;
  synthetic: boolean;
};
export type ObjectState = z.infer<typeof SemanticObject> & { rev: number };
export type RelationState = z.infer<typeof Relation> & { rev: number };
export type ArtifactRevision = Artifact & {
  rev: number;
  generation: number;
  locale: Locale;
  languageRevision: number;
  inputVersion: number;
  objectRefs: Ref[];
  elementSources?: Record<string, Ref[]>;
  createdAt: string;
};
export type Scenario = {
  id: string;
  artifactId: string;
  artifactRev: number;
  formula: Formula;
  values: Record<string, number | null>;
  result: string | null;
  baseInputVersion: number;
  createdAt: string;
};
export type Decision = {
  id: string;
  scope: 'personal' | 'meeting';
  artifact: ArtifactRevision;
  basis: string;
  participants: string;
  sources: Ref[];
  createdAt: string;
};
export type Translation = {
  segmentId: string;
  sourceRev: number;
  targetLocale: Locale;
  text: string;
  createdAt: string;
};
export type Meeting = {
  id: string;
  title: string;
  timezone: string;
  createdAt: string;
  endedAt: string | null;
  status: 'active' | 'ended';
  mode: 'manual' | 'microphone' | 'online' | 'replay';
  capture: 'idle' | 'starting' | 'capturing' | 'paused' | 'input_error' | 'stopped';
  epoch: number;
  revision: number;
  inputVersion: number;
  understoodVersion: number;
  languageRevision: number;
  outputLocale: Locale;
  segments: Segment[];
  translations: Translation[];
  inputGaps: Array<{ epoch: number; channel: string; receivedAt: string; code: string }>;
  objects: ObjectState[];
  relations: RelationState[];
  artifacts: ArtifactRevision[];
  scenarios: Scenario[];
  decisions: Decision[];
  focus: string;
  changes: string[];
  processing: 'idle' | 'working' | 'error';
  error: string | null;
  captureError: string | null;
  metrics: { calls: number; inputTokens: number; outputTokens: number; lastLatencyMs: number };
};
export type Preferences = {
  uiLocale: Locale;
  defaultOutputLocale: Locale;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  shortcut: string;
};
export type Snapshot = {
  meetings: Meeting[];
  preferences: Preferences;
  capabilities: {
    modelConfigured: boolean;
    sttConfigured: boolean;
    model: string;
    modelHost: string;
    sttHost: string;
    platform: string;
  };
  storageError: string | null;
};
export const Command = z
  .object({
    id,
    meetingId: id.nullable(),
    type: z.enum([
      'create',
      'ingest',
      'correct',
      'language',
      'ask',
      'retry',
      'captureStart',
      'captureReady',
      'captureError',
      'pause',
      'end',
      'scenario',
      'decision',
      'preferences',
    ]),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type Command = z.infer<typeof Command>;
export const expressionSchema = Expr;
