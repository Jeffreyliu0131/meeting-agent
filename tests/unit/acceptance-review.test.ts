import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionService } from '../../src/service/session';
import { SQLiteStore } from '../../src/service/store';
import type { ModelPort } from '../../src/agent/provider';
import type { Proposal } from '../../src/contracts/model';
const empty = (): Proposal => ({
  focus: 'Synthetic acceptance',
  changes: [],
  objects: [],
  relations: [],
  action: 'no_change',
  artifact: null,
  rationale: 'Protocol fixture',
});
const result = (proposal: Proposal) => ({ proposal, inputTokens: 1, outputTokens: 1 });
function setup(model: ModelPort) {
  const store = new SQLiteStore(
    join(mkdtempSync(join(tmpdir(), 'meeting-review-')), 'synthetic.sqlite'),
  );
  const service = new SessionService(store, model, {
    key: '',
    base: 'https://example.invalid',
    model: 'synthetic',
    sttKey: '',
    sttBase: 'https://example.invalid',
    sttModel: 'synthetic',
    format: 'json_schema',
    minBatchMs: 10000,
  });
  const id = service.command({
    id: crypto.randomUUID(),
    meetingId: null,
    type: 'create',
    payload: { title: 'Synthetic review', mode: 'manual', outputLocale: 'en', timezone: 'UTC' },
  }) as string;
  const command = (type: string, payload: Record<string, unknown>) =>
    service.command({ id: crypto.randomUUID(), meetingId: id, type, payload });
  return {
    service,
    store,
    id,
    command,
    ingest: (text: string, segmentId: string) =>
      command('ingest', { text, segmentId, kind: 'manual' }),
    get m() {
      return service.meetings[0];
    },
  };
}
test('review: historical source retrieval can inform a successful current batch', async () => {
  let search = false;
  const x = setup({
    interpret: async (m) => {
      if (search && !m.toolObservations?.length)
        return result({
          ...empty(),
          evidenceRequest: {
            kind: 'read_sources',
            query: '',
            refs: [{ id: 'old', rev: 1 }],
            cursor: 0,
            limit: 10,
            formulaId: '',
            overrides: {},
          },
        });
      if (search) assert.match(JSON.stringify(m.toolObservations), /original/);
      return result(empty());
    },
  });
  try {
    x.ingest('original', 'old');
    await x.service.process(x.id);
    x.command('correct', { segmentId: 'old', baseRevision: 1, text: 'corrected', speaker: null });
    await x.service.process(x.id);
    search = true;
    x.ingest('compare original and corrected', 'compare');
    await x.service.process(x.id);
    assert.equal(x.m.processedSources?.compare, 1);
    assert.equal(x.m.workflowJobs!.at(-1)!.status, 'succeeded');
  } finally {
    x.service.close();
  }
});
test('review: an invalid persisted clarification cannot poison subsequent independent input', async () => {
  const x = setup({
    interpret: async (m) => {
      if (m.segments.some((s) => s.id === 'good')) return result(empty());
      return result({
        ...empty(),
        action: 'request_clarification',
        clarification: {
          question: 'Which missing option?',
          candidates: [{ id: 'does-not-exist', rev: 1 }],
          affectedObjectIds: [],
          sources: [{ id: 'bad', rev: 1 }],
        },
      });
    },
  });
  try {
    x.ingest('ambiguous', 'bad');
    await x.service.process(x.id);
    assert.equal(x.m.processedSources?.bad, undefined);
    x.ingest('independent topic', 'good');
    await x.service.process(x.id);
    assert.equal(x.m.processedSources?.good, 1);
    assert.equal(x.m.processedSources?.bad, undefined);
    assert.ok(x.m.quarantinedSources?.bad);
  } finally {
    x.service.close();
  }
});

test('review: historical reads still reject a head changed after retrieval', async () => {
  const { readSet, addEvidenceRead, readsValid } = await import('../../src/service/workflow-state');
  const x = setup({ interpret: async () => result(empty()) });
  try {
    x.ingest('original', 'a');
    x.command('correct', { segmentId: 'a', baseRevision: 1, text: 'revision two', speaker: null });
    const read = readSet(x.m);
    read.sources = read.sources.filter((r) => r.rev === 2);
    addEvidenceRead(read, { kind: 'source', id: 'a', rev: 1 }, x.m);
    assert.equal(readsValid(read, x.m), true);
    x.command('correct', {
      segmentId: 'a',
      baseRevision: 2,
      text: 'revision three',
      speaker: null,
    });
    assert.equal(readsValid(read, x.m), false);
  } finally {
    x.service.close();
  }
});
test('review: production context capacity accounts for schema overhead before a call', async () => {
  const { OpenAIProvider } = await import('../../src/agent/provider');
  const { buildContextBatch } = await import('../../src/agent/context');
  const provider = new OpenAIProvider({
    key: 'synthetic',
    base: 'http://127.0.0.1',
    model: 'synthetic',
    sttKey: '',
    sttBase: 'http://127.0.0.1',
    sttModel: 'synthetic',
    format: 'json_schema',
  });
  const x = setup(provider);
  const fetch = globalThis.fetch;
  let called = false;
  try {
    x.ingest('A'.repeat(5000), 'a');
    x.ingest('B'.repeat(5000), 'b');
    x.ingest('C'.repeat(5000), 'c');
    x.ingest('D'.repeat(5000), 'd');
    const batch = buildContextBatch(structuredClone(x.m), provider.maxContextBytes);
    assert.ok(provider.maxContextBytes <= 24000);
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const bytes =
        Buffer.byteLength(body.messages[0].content) +
        Buffer.byteLength(body.messages[1].content) +
        Buffer.byteLength(JSON.stringify(body.response_format.json_schema.schema));
      assert.ok(bytes <= 60000, 'complete schema and evidence must fit the provider reservation');
      called = true;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(empty()) } }] }),
        { status: 200 },
      );
    };
    await provider.interpret(batch.meeting);
    assert.equal(called, true);
  } finally {
    globalThis.fetch = fetch;
    x.service.close();
  }
});

test('JSON-object component and impact requests explicitly ask for JSON for compatible providers', async () => {
  const { OpenAIProvider } = await import('../../src/agent/provider');
  const provider = new OpenAIProvider({
    key: 'synthetic',
    base: 'http://127.0.0.1',
    model: 'synthetic',
    sttKey: '',
    sttBase: 'http://127.0.0.1',
    sttModel: 'synthetic',
    format: 'json_object',
  });
  const previous = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.match(body.messages[0].content, /json/i);
      const content =
        requests++ === 0
          ? { content: null, clarification: '需要确定选项', audienceIds: [] }
          : { conflicts: [] };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
      );
    };
    await provider.prepareComponent({});
    await provider.analyzeImpact({});
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = previous;
  }
});

test('review: legacy IDs beginning new_ stay stable and cannot switch entity kind', async () => {
  const { resolveNewRefs } = await import('../../src/service/workflow-state');
  const x = setup({ interpret: async () => result(empty()) });
  try {
    const object = {
      id: 'new_legacy',
      kind: 'topic' as const,
      title: 'Legacy',
      detail: '',
      sources: [],
      origin: 'stated' as const,
      status: 'unverified' as const,
      lifecycle: 'active' as const,
    };
    x.m.objects = [{ ...object, rev: 1 }];
    const p = { ...empty(), objects: [object] };
    assert.equal(resolveNewRefs(p, x.m).proposal.objects[0].id, 'new_legacy');
    assert.throws(
      () =>
        resolveNewRefs(
          {
            ...empty(),
            relations: [
              {
                id: 'new_legacy',
                from: 'new_legacy',
                to: 'new_legacy',
                kind: 'supports',
                sources: [],
                origin: 'stated',
              },
            ],
          },
          x.m,
        ),
      /ID_KIND_MISMATCH/,
    );
  } finally {
    x.service.close();
  }
});
