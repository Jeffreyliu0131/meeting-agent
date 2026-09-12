import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../../src/service/store';
import { SessionService } from '../../src/service/session';
import { executeEvidence, type EvidenceRequest } from '../../src/agent/tools';
import {
  resolveNewRefs,
  readSet,
  readsValid,
  assertLease,
  expressionIdentity,
} from '../../src/service/workflow-state';
import { validatePresentationRepair } from '../../src/domain/expression-repair';
import { CallPool } from '../../src/service/call-pool';
import { calculate } from '../../src/domain/calculator';
import type { Meeting, Proposal, Artifact } from '../../src/contracts/model';
import type { ModelPort } from '../../src/agent/provider';

const config = {
  key: '',
  base: 'https://example.invalid',
  model: 'synthetic',
  sttKey: '',
  sttBase: 'https://example.invalid',
  sttModel: 'synthetic',
  format: 'json_schema',
  minBatchMs: 10000,
};
const empty = (): Proposal => ({
  focus: 'Synthetic',
  changes: [],
  objects: [],
  relations: [],
  action: 'no_change',
  artifact: null,
  rationale: 'Protocol only',
});
const result = (proposal: Proposal) => ({ proposal, inputTokens: 0, outputTokens: 0 });
const query = (
  kind: EvidenceRequest['kind'],
  query = '',
  refs: EvidenceRequest['refs'] = [],
): EvidenceRequest => ({ kind, query, refs, cursor: 0, limit: 20, formulaId: '', overrides: {} });
const wait = async (predicate: () => boolean) => {
  for (let n = 0; n < 500 && !predicate(); n++) await new Promise((r) => setTimeout(r, 2));
  assert.ok(predicate(), 'expected event within 1 second');
};
function setup(
  model: ModelPort = { interpret: async () => result(empty()) },
  evidence?: ConstructorParameters<typeof SessionService>[5],
) {
  const path = join(mkdtempSync(join(tmpdir(), 'workflow-synthetic-')), 'test.sqlite');
  const store = new SQLiteStore(path),
    service = new SessionService(store, model, config, () => {}, undefined, evidence);
  const id = service.command({
    id: crypto.randomUUID(),
    meetingId: null,
    type: 'create',
    payload: { title: 'Synthetic', mode: 'manual', outputLocale: 'en', timezone: 'UTC' },
  }) as string;
  const command = (type: string, payload: Record<string, unknown> = {}) =>
    service.command({ id: crypto.randomUUID(), meetingId: id, type, payload });
  const ingest = (text: string, segmentId: string = crypto.randomUUID()) =>
    command('ingest', { text, segmentId, kind: 'manual' });
  return {
    service,
    store,
    id,
    path,
    command,
    ingest,
    get m() {
      return service.meetings[0];
    },
  };
}
test('W1 new refs map cross references, old IDs remain stable, dangling refs reject', () => {
  const x = setup();
  try {
    const p = empty();
    p.objects = [
      {
        id: 'new_condition',
        kind: 'constraint',
        title: 'Approval',
        detail: '',
        origin: 'stated',
        status: 'unknown',
        sources: [],
        lifecycle: 'active',
      },
      {
        id: 'new_task',
        kind: 'task',
        title: 'Launch',
        detail: '',
        origin: 'stated',
        status: 'unknown',
        sources: [],
        lifecycle: 'active',
      },
    ];
    p.relations = [
      {
        id: 'new_link',
        from: 'new_task',
        to: 'new_condition',
        kind: 'depends_on',
        sources: [],
        origin: 'stated',
      },
    ];
    const resolved = resolveNewRefs(p, x.m);
    assert.notEqual(resolved.proposal.objects[0].id, 'new_condition');
    assert.equal(resolved.proposal.relations[0].to, resolved.idMap.new_condition);
    assert.equal(p.objects[0].id, 'new_condition');
    p.relations[0].to = 'new_missing';
    assert.throws(() => resolveNewRefs(p, x.m), /UNKNOWN_NEW_REF/);
  } finally {
    x.service.close();
  }
});
test('W1 read set allows unrelated append but rejects read revision and expired fencing', () => {
  const x = setup();
  try {
    x.ingest('first', 'a');
    const reads = readSet(x.m);
    x.ingest('second', 'b');
    assert.equal(readsValid(reads, x.m), true);
    x.command('correct', { segmentId: 'a', baseRevision: 1, text: 'changed', speaker: null });
    assert.equal(readsValid(reads, x.m), false);
    assert.throws(
      () => assertLease({ fence: 2, leaseUntil: Date.now() + 1000, status: 'running' } as any, 1),
      /JOB_FENCED/,
    );
  } finally {
    x.service.close();
  }
});
test('W1 saved immutable proposal recovers after domain save failure without another model call', async () => {
  let calls = 0;
  const model = {
    interpret: async () => {
      calls++;
      return result(empty());
    },
  };
  const x = setup(model);
  x.ingest('accepted', 'a');
  const save = x.store.save.bind(x.store);
  let fail = true;
  x.store.save = (m, p, c) => {
    if (c?.id.startsWith('workflow_') && fail) {
      fail = false;
      throw new Error('SYNTHETIC_DISK_FAILURE');
    }
    save(m, p, c);
  };
  await x.service.process(x.id);
  assert.equal(calls, 1);
  assert.equal(x.m.processedSources?.a, undefined);
  assert.ok(x.m.workflowJobs?.[0].proposal);
  x.service.close();
  const restored = new SessionService(new SQLiteStore(x.path), model, config);
  try {
    await restored.process(x.id);
    assert.equal(calls, 1);
    assert.equal(restored.meetings[0].processedSources?.a, 1);
    assert.equal(restored.meetings[0].workflowJobs?.[0].status, 'succeeded');
    assert.notEqual(restored.meetings[0].capture, 'capturing');
    const job = restored.meetings[0].workflowJobs![0];
    job.proposal!.focus = 'tamper';
    assert.throws(
      () => restored.store.save(restored.meetings, restored.preferences),
      /PROPOSAL_MUTATED/,
    );
  } finally {
    restored.close();
  }
});
test('W1 failed input exhausts budget, stays visible and no longer blocks independent input', async () => {
  const x = setup({
    interpret: async (m) => {
      if (m.segments.some((s) => s.id === 'bad') && !m.segments.some((s) => s.id === 'good'))
        throw new Error('MODEL_HTTP_503');
      return result(empty());
    },
  });
  try {
    x.ingest('bad input', 'bad');
    await x.service.process(x.id);
    await x.service.process(x.id);
    assert.equal(x.m.quarantinedSources?.bad, 1);
    assert.equal(x.m.processedSources?.bad, undefined);
    x.ingest('independent', 'good');
    await x.service.process(x.id);
    assert.equal(x.m.processedSources?.good, 1);
    assert.equal(x.m.processedSources?.bad, undefined);
    x.command('end');
    assert.equal(x.m.closeout?.state, 'needs_review');
  } finally {
    x.service.close();
  }
});
test('W2 versioned Chinese short-word search, neighbor pages and explicit missing coverage', () => {
  const x = setup();
  try {
    x.ingest('预算 SGD 30', 'old');
    x.ingest('budget discussion', 'next');
    x.command('correct', { segmentId: 'old', baseRevision: 1, text: '预算 SGD 40', speaker: null });
    const found = executeEvidence(query('search_meeting', '预算'), x.m, 'meeting');
    assert.equal(found.refs[0].rev, 2);
    const old = executeEvidence(query('read_sources', '', [{ id: 'old', rev: 1 }]), x.m, 'meeting');
    assert.match(JSON.stringify(old.values), /30/);
    const page = executeEvidence(
      { ...query('neighbors', '', [{ id: 'old', rev: 2 }]), limit: 1 },
      x.m,
      'meeting',
    );
    assert.equal(page.coverage.hasMore, true);
    assert.equal(page.coverage.cursor, 1);
    x.command('ask', { text: 'PRIVATE_MARKER' });
    assert.equal(
      executeEvidence(query('search_meeting', 'PRIVATE_MARKER'), x.m, 'meeting').values.length,
      0,
    );
  } finally {
    x.service.close();
  }
});
test('W2 active evidence branch executes before second interpretation and persists observations', async () => {
  let calls = 0;
  const x = setup({
    interpret: async (m) => {
      calls++;
      if (!m.toolObservations?.length)
        return result({ ...empty(), evidenceRequest: query('search_meeting', '预算') });
      assert.match(JSON.stringify(m.toolObservations), /预算/);
      return result(empty());
    },
  });
  try {
    x.ingest('预算有条件', 'a');
    await x.service.process(x.id);
    assert.equal(calls, 2);
    assert.equal(x.m.workflowJobs![0].toolCalls, 1);
    assert.equal(x.m.processedSources?.a, 1);
  } finally {
    x.service.close();
  }
});
test('W3 personal tool wait does not hold meeting lock; cancellation rejects late result', async () => {
  let release!: () => void,
    entered = false;
  const x = setup(
    {
      interpret: async (m) =>
        result(
          m.contextScope === 'personal' && !m.toolObservations?.length
            ? { ...empty(), evidenceRequest: query('search_meeting', 'context') }
            : empty(),
        ),
    },
    async (...args) => {
      entered = true;
      await new Promise<void>((r) => {
        release = r;
      });
      return executeEvidence(...args);
    },
  );
  try {
    x.ingest('context', 'a');
    await x.service.process(x.id);
    const request = x.command('ask', { text: 'what if?' }) as { id: string };
    const work = x.service.process(x.id);
    await wait(() => entered);
    x.ingest('independent new topic', 'b');
    await x.service.process(x.id);
    assert.equal(x.m.processedSources?.b, 1);
    x.command('cancelRequest', { requestId: request.id });
    release();
    await work;
    const job = x.m.workflowJobs!.find((j) => j.requestId === request.id)!;
    assert.equal(job.status, 'cancelled');
    assert.equal(x.m.processedSources?.[request.id], undefined);
    assert.equal(job.modelCalls, 1);
  } finally {
    x.service.close();
  }
});
test('W3 reserved understanding capacity survives occupied background lanes', async () => {
  const pool = new CallPool(),
    signal = new AbortController().signal;
  const releases = await Promise.all([
    pool.acquire('personal', signal),
    pool.acquire('generate', signal),
    pool.acquire('transcribe', signal),
  ]);
  const meeting = await pool.acquire('understand', signal);
  meeting();
  releases.forEach((r) => r());
});
test('W4 clarification searches first, persists one question, personal answer never creates meeting speech', async () => {
  const x = setup({
    interpret: async (m) =>
      result(
        m.contextScope === 'personal'
          ? empty()
          : {
              ...empty(),
              action: 'request_clarification',
              clarification: {
                question: 'Which option?',
                candidates: [],
                affectedObjectIds: [],
                sources: [{ id: 'a', rev: 1 }],
              },
            },
      ),
  });
  try {
    x.ingest('that option', 'a');
    await x.service.process(x.id);
    assert.equal(x.m.workflowJobs![0].toolCalls, 1);
    assert.equal(x.m.clarifications?.length, 1);
    const id = x.m.clarifications![0].id;
    x.command('answerClarification', { clarificationId: id, answer: 'Option A' });
    assert.equal(x.m.clarifications![0].status, 'answered');
    assert.equal(x.m.segments.at(-1)?.kind, 'request');
    await x.service.process(x.id);
    assert.equal(x.m.objects.length, 0);
  } finally {
    x.service.close();
  }
});
test('W5 purpose identity includes scope, branch and ordered object roles', () => {
  const base = {
    scope: 'meeting' as const,
    artifact: null,
    plan: {
      purposeKey: 'compare',
      question: '?',
      instruction: '',
      objectIds: ['A', 'B'],
      sources: [],
    },
  };
  assert.notEqual(
    expressionIdentity(base),
    expressionIdentity({ ...base, scope: 'personal', branchId: 'one' }),
  );
  assert.notEqual(
    expressionIdentity({ ...base, scope: 'personal', branchId: 'one' }),
    expressionIdentity({ ...base, scope: 'personal', branchId: 'two' }),
  );
  assert.notEqual(
    expressionIdentity(base),
    expressionIdentity({ ...base, plan: { ...base.plan, objectIds: ['B', 'A'] } }),
  );
});
test('W5 dimension mismatch and content-changing repair are rejected', () => {
  assert.throws(
    () =>
      calculate({
        id: 'f',
        label: '',
        unit: 'SGD',
        parameters: [
          { id: 'a', label: '', unit: 'SGD', value: 1, min: 0, max: 10 },
          { id: 'b', label: '', unit: 'USD', value: 2, min: 0, max: 10 },
        ],
        steps: [{ id: 'sum', op: 'add', left: 'a', right: 'b' }],
        result: 'sum',
        basis: 'a+b',
        sources: [],
      }),
    /UNIT_MISMATCH/,
  );
  const a = {
    id: 'a',
    purposeKey: 'a',
    question: '?',
    summary: 'fixed',
    objectIds: [],
    sources: [],
    formulas: [],
    blocks: [],
    layout: 'stack',
  } as Artifact;
  validatePresentationRepair(a, { ...a, layout: 'columns' } as Artifact);
  assert.throws(
    () => validatePresentationRepair(a, { ...a, summary: 'different fact' }),
    /REPAIR_CHANGED_CONTENT/,
  );
});

test('W3 a real 30-second synthetic tool wait permits meeting completion before returning', async () => {
  let entered = false,
    finished = false;
  const x = setup(
    {
      interpret: async (m) =>
        result(
          m.contextScope === 'personal' && !m.toolObservations?.length
            ? { ...empty(), evidenceRequest: query('search_meeting', 'baseline') }
            : empty(),
        ),
    },
    async (...args) => {
      entered = true;
      await new Promise((r) => setTimeout(r, 30000));
      finished = true;
      return executeEvidence(...args);
    },
  );
  try {
    x.ingest('baseline', 'a');
    await x.service.process(x.id);
    x.command('ask', { text: 'compare' });
    const personal = x.service.process(x.id);
    await wait(() => entered);
    x.ingest('new live content', 'b');
    await x.service.process(x.id);
    assert.equal(x.m.processedSources?.b, 1);
    assert.equal(finished, false);
    await personal;
    assert.equal(x.m.workflowJobs!.find((j) => j.scope === 'personal')?.status, 'succeeded');
  } finally {
    x.service.close();
  }
});

test('W3 request baseline persists at send time through source correction and restart', async () => {
  let observed = '';
  const model = {
    interpret: async (m: Meeting) => {
      if (m.contextScope === 'personal') observed = m.segments.find((s) => s.id === 'a')!.text;
      return result(empty());
    },
  };
  const x = setup(model);
  x.ingest('original baseline', 'a');
  await x.service.process(x.id);
  x.command('ask', { text: 'compare' });
  x.command('correct', {
    segmentId: 'a',
    baseRevision: 1,
    text: 'changed after send',
    speaker: null,
  });
  x.service.close();
  const restored = new SessionService(new SQLiteStore(x.path), model, config);
  try {
    await restored.process(x.id);
    assert.equal(observed, 'original baseline');
    const job = restored.meetings[0].workflowJobs!.find((j) => j.scope === 'personal')!;
    assert.equal(job.status, 'succeeded');
    assert.equal(job.readSet.sources.find((r) => r.id === 'a')?.rev, 1);
  } finally {
    restored.close();
  }
});

test('W4 later explicit evidence resolves persisted clarification without promoting personal answers', async () => {
  const x = setup({
    interpret: async (m) => {
      if (m.segments.some((s) => s.id === 'resolved'))
        return result({
          ...empty(),
          resolvesClarification: {
            id: m.clarifications![0].id,
            sources: [{ id: 'resolved', rev: 1 }],
          },
        });
      return result({
        ...empty(),
        action: 'request_clarification',
        clarification: {
          question: 'Which plan?',
          candidates: [],
          affectedObjectIds: [],
          sources: [{ id: 'a', rev: 1 }],
        },
      });
    },
  });
  try {
    x.ingest('ambiguous', 'a');
    await x.service.process(x.id);
    x.ingest('explicit Plan A', 'resolved');
    await x.service.process(x.id);
    assert.equal(x.m.clarifications![0].status, 'resolved');
    assert.deepEqual(x.m.clarifications![0].resolutionSources, [{ id: 'resolved', rev: 1 }]);
  } finally {
    x.service.close();
  }
});

test('W5 preview error reaches one repair and preserves the submitted content', async () => {
  let previews = 0,
    generations = 0;
  const model: ModelPort = {
    interpret: async (m) =>
      result({
        ...empty(),
        action: 'create_artifact',
        plan: {
          purposeKey: 'view',
          question: '?',
          instruction: 'text',
          objectIds: [],
          sources: [{ id: m.segments[0].id, rev: 1 }],
        },
      }),
    generate: async (m, _p, repair) => {
      generations++;
      if (generations === 2) assert.match(repair ?? '', /RENDER_OVERFLOW/);
      return {
        artifact: {
          id: 'view',
          purposeKey: 'view',
          question: '?',
          summary: 'fixed',
          layout: generations === 1 ? 'columns' : 'stack',
          objectIds: [],
          sources: [{ id: m.segments[0].id, rev: 1 }],
          formulas: [],
          blocks: [
            {
              id: 'body',
              type: 'text',
              title: 'Fixed',
              items: ['fixed'],
              objectIds: [],
              sources: [
                {
                  id: m.segments.find((s) => s.kind === 'request')?.id ?? m.segments[0].id,
                  rev: 1,
                },
              ],
              origin: 'agent_inferred',
              status: 'assumed',
            },
          ],
        },
        inputTokens: 0,
        outputTokens: 0,
      };
    },
  };
  const x = setup(model);
  (x.service as any).preview = async () => {
    previews++;
    if (previews === 1) {
      const { RenderFailure } = await import('../../src/contracts/render-report');
      throw new RenderFailure({
        ok: false,
        issues: [{ blockId: null, errorCode: 'RENDER_OVERFLOW', viewport: 800 }],
      });
    }
  };
  try {
    x.ingest('synthetic', 'a');
    await x.service.process(x.id);
    assert.equal(generations, 2);
    assert.equal(previews, 2);
    assert.equal(x.m.artifacts.length, 1);
    assert.equal(x.m.artifacts[0].summary, 'fixed');
  } finally {
    x.service.close();
  }
});

test('W5 distinct personal requests cannot reuse each other artifact ID even with same purpose', async () => {
  const x = setup({
    interpret: async (m) =>
      result(
        m.contextScope === 'personal'
          ? {
              ...empty(),
              action: 'create_artifact',
              artifact: {
                id: 'same',
                purposeKey: 'same',
                question: '?',
                summary: 'personal',
                layout: 'stack',
                objectIds: [],
                sources: [{ id: m.segments.find((s) => s.kind === 'request')!.id, rev: 1 }],
                formulas: [],
                blocks: [
                  {
                    id: 'body',
                    type: 'text',
                    title: 'Fixed',
                    items: ['fixed'],
                    objectIds: [],
                    sources: [
                      {
                        id: m.segments.find((s) => s.kind === 'request')?.id ?? m.segments[0].id,
                        rev: 1,
                      },
                    ],
                    origin: 'agent_inferred',
                    status: 'assumed',
                  },
                ],
              },
            }
          : empty(),
      ),
  });
  try {
    x.ingest('base', 'a');
    await x.service.process(x.id);
    x.command('ask', { text: 'one' });
    await x.service.process(x.id);
    x.command('ask', { text: 'two' });
    await x.service.process(x.id);
    assert.equal(x.m.artifacts.length, 2);
    assert.notEqual(x.m.artifacts[0].id, x.m.artifacts[1].id);
    assert.notEqual(x.m.artifacts[0].branchId, x.m.artifacts[1].branchId);
  } finally {
    x.service.close();
  }
});

test('W1 object aliases never rewrite source IDs or formula parameters', () => {
  const x = setup();
  try {
    const p = empty();
    p.objects = [
      {
        id: 'same',
        kind: 'topic',
        title: 't',
        detail: '',
        origin: 'stated',
        status: 'unknown',
        sources: [{ id: 'same', rev: 1 }],
        lifecycle: 'active',
      },
    ];
    const r = resolveNewRefs(p, x.m);
    assert.notEqual(r.proposal.objects[0].id, 'same');
    assert.equal(r.proposal.objects[0].sources[0].id, 'same');
  } finally {
    x.service.close();
  }
});
test('W5 computed chart binding verifies host result identity, unit and value', async () => {
  const { validateArtifact } = await import('../../src/renderers/validate');
  const x = setup();
  try {
    x.ingest('explicit total 3', 'a');
    const m = structuredClone(x.m);
    m.toolObservations = [
      {
        resultId: 'trusted',
        kind: 'calculate',
        status: 'known',
        values: [{ result: '3', unit: 'SGD' }],
      },
    ];
    const a: Artifact = {
      id: 'view',
      purposeKey: 'view',
      question: '?',
      summary: '',
      layout: 'stack',
      objectIds: [],
      sources: [{ id: 'a', rev: 1 }],
      formulas: [],
      blocks: [
        {
          id: 'chart',
          type: 'chart',
          title: 'Total',
          objectIds: [],
          sources: [{ id: 'a', rev: 1 }],
          origin: 'agent_inferred',
          status: 'assumed',
          unit: 'SGD',
          values: [
            {
              label: 'Total',
              value: 3,
              sources: [{ id: 'a', rev: 1 }],
              binding: { resultId: 'trusted' },
            },
          ],
        },
      ],
    };
    validateArtifact(a, m, [], []);
    const b = structuredClone(a);
    if (b.blocks[0].type === 'chart') b.blocks[0].values[0].value = 4;
    assert.throws(() => validateArtifact(b, m, [], []), /TOOL_VALUE_MISMATCH/);
  } finally {
    x.service.close();
  }
});
test('W2 meeting retrieval excludes legacy personal object history and clarification', () => {
  const x = setup();
  try {
    const s = x.command('ask', { text: 'PRIVATE' }) as { id: string };
    x.m.objectHistory = [
      {
        id: 'private',
        rev: 1,
        kind: 'claim',
        title: 'PRIVATE',
        detail: 'PRIVATE',
        sources: [{ id: s.id, rev: 1 }],
        origin: 'agent_inferred',
        status: 'assumed',
        lifecycle: 'active',
      },
    ];
    const result = executeEvidence(
      query('read_objects', '', [{ id: 'private', rev: 1 }]),
      x.m,
      'meeting',
    );
    assert.equal(result.values.length, 0);
  } finally {
    x.service.close();
  }
});

test('W1 CAS re-planning shares the same source batch budget instead of resetting it', async () => {
  let calls = 0;
  let x: ReturnType<typeof setup>;
  x = setup({
    interpret: async () => {
      calls++;
      x.command('rename', {
        title: 'Changed ' + calls,
        baseRevision: x.m.titleMeta?.revision ?? 0,
      });
      return result(empty());
    },
  });
  try {
    x.ingest('same accepted batch', 'a');
    await x.service.process(x.id);
    await x.service.process(x.id);
    await x.service.process(x.id);
    assert.equal(calls, 2);
    assert.equal(x.m.processedSources?.a, undefined);
    assert.equal(x.m.quarantinedSources?.a, 1);
  } finally {
    x.service.close();
  }
});

test('W1 interruption before proposal persistence resumes within the original call budget', async () => {
  let calls = 0;
  let x: ReturnType<typeof setup>;
  x = setup({
    interpret: async () => {
      calls++;
      x.service.close();
      return result(empty());
    },
  });
  x.ingest('accepted', 'a');
  await x.service.process(x.id);
  const restored = new SessionService(
    new SQLiteStore(x.path),
    {
      interpret: async () => {
        calls++;
        return result(empty());
      },
    },
    config,
  );
  try {
    await restored.process(x.id);
    assert.equal(calls, 2);
    assert.equal(restored.meetings[0].workflowJobs![0].modelCalls, 2);
    assert.equal(restored.meetings[0].processedSources?.a, 1);
  } finally {
    restored.close();
  }
});

test('W1 interruption after atomic commit restores success without duplicate model work', async () => {
  let calls = 0;
  const model = {
    interpret: async () => {
      calls++;
      return result(empty());
    },
  };
  const x = setup(model);
  x.ingest('accepted', 'a');
  const save = x.store.save.bind(x.store);
  x.store.save = (m, p, c) => {
    save(m, p, c);
    if (c?.id.startsWith('workflow_')) {
      x.service.close();
      throw new Error('SYNTHETIC_PROCESS_EXIT_AFTER_COMMIT');
    }
  };
  await x.service.process(x.id);
  const restored = new SessionService(new SQLiteStore(x.path), model, config);
  try {
    await restored.process(x.id);
    assert.equal(calls, 1);
    assert.equal(restored.meetings[0].processedSources?.a, 1);
    assert.equal(
      restored.meetings[0].workflowJobs!.filter((j) => j.status === 'succeeded').length,
      1,
    );
  } finally {
    restored.close();
  }
});

test('W3 personal artifact keeps the bound object revision when the live object changes', async () => {
  const x = setup({
    interpret: async (m) =>
      result(
        m.contextScope === 'personal'
          ? {
              ...empty(),
              action: 'create_artifact',
              artifact: {
                id: 'p',
                purposeKey: 'p',
                question: '?',
                summary: 'old baseline',
                layout: 'stack',
                objectIds: ['object'],
                sources: [{ id: 'a', rev: 1 }],
                formulas: [],
                blocks: [
                  {
                    id: 'body',
                    type: 'text',
                    title: 'Old',
                    items: ['old'],
                    objectIds: ['object'],
                    sources: [{ id: 'a', rev: 1 }],
                    origin: 'agent_inferred',
                    status: 'assumed',
                  },
                ],
              },
            }
          : empty(),
      ),
  });
  try {
    x.ingest('old', 'a');
    await x.service.process(x.id);
    x.m.objects = [
      {
        id: 'object',
        rev: 1,
        kind: 'topic',
        title: 'Object',
        detail: 'old',
        sources: [{ id: 'a', rev: 1 }],
        origin: 'stated',
        status: 'unverified',
        lifecycle: 'active',
      },
    ];
    x.command('ask', { text: 'compare', context: { objectRefs: [{ id: 'object', rev: 1 }] } });
    x.command('correct', { segmentId: 'a', baseRevision: 1, text: 'new', speaker: null });
    await x.service.process(x.id);
    const a = x.m.artifacts.find((a) => a.scope === 'personal');
    assert.ok(a);
    assert.equal(a.objectRefs[0].rev, 1);
    assert.ok(x.m.objects[0].rev > 1);
  } finally {
    x.service.close();
  }
});
