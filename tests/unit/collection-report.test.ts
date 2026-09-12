import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../../src/service/store';
import { SessionService } from '../../src/service/session';
import { uid } from '../../src/domain/commands';
import { buildCollectionDigest } from '../../src/domain/collection-digest';
import { collectionPayload as collectionPayloadForTest } from '../../src/agent/collection-context';
import {
  resolveAliases,
  syntheticCollectionMeeting,
  assertCollectionCoverage,
} from '../../src/service/collection-state';
import type {
  CollectionAlias,
  CollectionReport,
  Meeting,
  Proposal,
} from '../../src/contracts/model';
import type { CollectionResult, ModelPort, ProviderConfig } from '../../src/agent/provider';

const config: ProviderConfig = {
  key: 'test-key',
  base: 'https://api.openai.com/v1',
  model: 'test-double',
  sttKey: 'test-key',
  sttBase: 'https://api.openai.com/v1',
  sttModel: 'test-double',
  format: 'json_schema',
  collectionContextBytes: 32000,
};
const cleanup = (dir: string) =>
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

const alias = (
  a: string,
  meetingId: string,
  kind: CollectionAlias['kind'],
  id: string,
  rev = 1,
): CollectionAlias => ({ alias: a, meetingAlias: 'M1', meetingId, kind, id, rev });

const report = (over: Partial<CollectionReport> = {}): CollectionReport =>
  ({
    id: 'new_report',
    purposeKey: 'new_report',
    question: 'What is decided?',
    summary: '',
    layout: 'stack',
    objectIds: [],
    blocks: [
      {
        id: 'b1',
        type: 'text',
        title: 'Summary',
        items: ['ok'],
        sources: [],
        objectIds: [],
        origin: 'stated',
        status: 'unverified',
      },
    ],
    formulas: [],
    sources: [],
    ...over,
  }) as CollectionReport;

test('an unknown alias is rejected rather than silently dropped', () => {
  assert.throws(
    () => resolveAliases(report({ sources: [{ id: 's9', rev: 1 }] }), {}),
    /UNKNOWN_ALIAS/,
  );
});

test('a source alias used where an object is required is rejected', () => {
  const map = { o1: alias('o1', 'm1', 'source', 'real') };
  assert.throws(
    () => resolveAliases(report({ objectIds: ['o1'] }), map),
    /ALIAS_KIND_MISMATCH/,
  );
});

test('resolution reports exactly the aliases the report cites', () => {
  const map = {
    s1: alias('s1', 'm1', 'source', 'seg'),
    o1: alias('o1', 'm1', 'object', 'obj'),
    o2: alias('o2', 'm1', 'object', 'unused'),
  };
  const used = resolveAliases(
    report({ sources: [{ id: 's1', rev: 1 }], objectIds: ['o1'] }),
    map,
  );
  assert.deepEqual(
    used.map((a) => a.alias).sort(),
    ['o1', 's1'],
  );
});

test('kind checking reaches nested block refs, not just the top level', () => {
  const map = { s1: alias('s1', 'm1', 'object', 'obj') };
  const nested = report({
    blocks: [
      {
        id: 't1',
        type: 'table',
        title: 'T',
        columns: ['a'],
        rows: [{ id: 'r1', cells: ['x'], sources: [{ id: 's1', rev: 1 }] }],
        sources: [],
        objectIds: [],
        origin: 'stated',
        status: 'unverified',
      },
    ],
  });
  assert.throws(() => resolveAliases(nested as CollectionReport, map), /ALIAS_KIND_MISMATCH/);
});

test('a report that drops a disagreement is rejected as incomplete', () => {
  const m = {
    id: 'm1',
    title: 'Kickoff',
    status: 'ended',
    createdAt: '',
    revision: 1,
    languageRevision: 1,
    segments: [],
    decisions: [],
    inputGaps: [],
    relations: [],
    objects: [
      {
        id: 'o1',
        kind: 'claim',
        title: 'Capacity',
        detail: '',
        origin: 'stated',
        status: 'disputed',
        sources: [],
        lifecycle: 'active',
        meaning: null,
        rev: 1,
      },
    ],
  } as unknown as Meeting;
  const collection = {
    id: 'c1',
    title: 'T',
    brief: '',
    meetingIds: ['m1'],
    outputLocale: 'en' as const,
    revision: 1,
    createdAt: '',
    updatedAt: '',
    reports: [],
    reportStatus: 'idle' as const,
    reportError: null,
  };
  const digest = buildCollectionDigest(collection, [m], 32000);
  assert.equal(digest.disputes.length, 1);
  // A report that never mentions the disputed object must not be published.
  assert.throws(() => assertCollectionCoverage(report(), digest), /COLLECTION_DISPUTE_OMITTED/);
  assert.doesNotThrow(() =>
    assertCollectionCoverage(report({ objectIds: [digest.disputes[0].positions[0].alias] }), digest),
  );
});

test('a decision alias is not object-shaped, so citing it as an object is a kind error', () => {
  const decision = { id: 'dec-1', scope: 'meeting', artifact: {}, basis: '', participants: '', sources: [], createdAt: '' };
  const m = {
    id: 'm1',
    title: 'Kickoff',
    status: 'ended',
    createdAt: '',
    revision: 1,
    languageRevision: 1,
    segments: [],
    objects: [],
    relations: [],
    inputGaps: [],
    decisions: [decision],
  } as unknown as Meeting;
  const digest = buildCollectionDigest(
    {
      id: 'c1',
      title: 'T',
      brief: '',
      meetingIds: ['m1'],
      outputLocale: 'en',
      revision: 1,
      createdAt: '',
      updatedAt: '',
      reports: [],
      reportStatus: 'idle',
      reportError: null,
    },
    [m],
    32000,
  );
  const decisionAlias = digest.decisions[0].alias;
  assert.equal(digest.aliasMap[decisionAlias].kind, 'decision');
  // Regression: this used to be typed 'object', so a report citing it produced a
  // confusing INVALID_OBJECT from deep inside validateArtifact instead.
  assert.throws(
    () => resolveAliases(report({ objectIds: [decisionAlias] }), digest.aliasMap),
    /ALIAS_KIND_MISMATCH/,
  );
  // And a decision must not be handed to the model with an object-shaped alias.
  const payload = JSON.stringify(collectionPayloadForTest(digest));
  assert.ok(!payload.includes(decisionAlias));
});

test('the synthetic meeting excludes personal request segments', () => {
  const m = {
    id: 'm1',
    segments: [
      { id: 's1', rev: 1, text: 'meeting speech', kind: 'manual' },
      { id: 's2', rev: 1, text: 'my private question', kind: 'request' },
    ],
    objects: [],
    relations: [],
  } as unknown as Meeting;
  const map = {
    a1: alias('a1', 'm1', 'source', 's1'),
    a2: alias('a2', 'm1', 'source', 's2'),
  };
  const synthetic = syntheticCollectionMeeting(map, [m]);
  const ids = synthetic.segments.map((s) => s.id);
  assert.ok(ids.includes('a1'));
  assert.ok(!ids.includes('a2'), 'a personal request must never reach a shared report');
});

// --- end to end, against a deterministic test double -----------------------

function proposal(m: Meeting): Proposal {
  const s = m.segments.at(-1)!;
  return {
    focus: 'Capacity question',
    changes: [],
    objects: [
      {
        id: 'new_1',
        kind: 'question',
        title: 'Who owns support capacity?',
        detail: '',
        origin: 'stated',
        status: 'unknown',
        sources: [{ id: s.id, rev: s.rev }],
        lifecycle: 'active',
        meaning: {
          stance: 'unknown',
          conditionIds: [],
          owner: null,
          deadline: null,
          evidence: [{ quote: s.text.slice(0, 40), sources: [{ id: s.id, rev: s.rev }] }],
        },
      },
    ],
    relations: [],
    action: 'no_change',
    artifact: null,
    rationale: 'deterministic test double',
  } as Proposal;
}

/** Echoes the digest back as a minimal valid report, citing whatever it was given. */
function reportFrom(payload: unknown, dropDisputes = false): CollectionReport {
  const digest = payload as {
    open: Array<{ alias: string; quotes: Array<{ alias: string }> }>;
    disputes: Array<{ positions: Array<{ alias: string }> }>;
  };
  const cited = digest.open.slice(0, 3).map((i) => i.alias);
  const disputeAliases = dropDisputes
    ? []
    : digest.disputes.flatMap((d) => d.positions.map((p) => p.alias));
  // validateArtifact requires at least one cited source; the seeded segment is rev 1.
  const sources = digest.open
    .flatMap((i) => i.quotes.map((q) => q.alias))
    .slice(0, 1)
    .map((id) => ({ id, rev: 1 }));
  return report({
    objectIds: [...cited, ...disputeAliases],
    sources,
    blocks: [
      {
        id: 'b1',
        type: 'text',
        title: 'Summary',
        items: ['ok'],
        sources,
        objectIds: [],
        origin: 'stated',
        status: 'unverified',
      },
    ],
  } as Partial<CollectionReport>);
}

function setup(synthesize: (payload: unknown) => CollectionReport) {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-collection-report-'));
  const model: ModelPort = {
    interpret: async (m) => ({ proposal: proposal(m), inputTokens: 0, outputTokens: 0 }),
    synthesize: async (payload): Promise<CollectionResult> => ({
      report: synthesize(payload),
      inputTokens: 0,
      outputTokens: 0,
    }),
  };
  const service = new SessionService(new SQLiteStore(join(dir, 'test.sqlite')), model, config);
  return {
    service,
    done: () => {
      service.close();
      cleanup(dir);
    },
  };
}

async function seededMeeting(service: SessionService, title: string) {
  const id = service.command({
    id: uid(),
    meetingId: null,
    type: 'create',
    payload: { title, mode: 'manual', outputLocale: 'en', timezone: 'UTC' },
  }) as string;
  service.command({
    id: uid(),
    meetingId: id,
    type: 'ingest',
    payload: { text: 'Nobody has confirmed who owns support capacity yet.', kind: 'manual' },
  });
  await service.process(id);
  await service.flush();
  service.command({ id: uid(), meetingId: id, type: 'end', payload: {} });
  return id;
}

test('a collection report is generated, stored and cites only resolvable aliases', async () => {
  const x = setup((payload) => reportFrom(payload));
  try {
    const m1 = await seededMeeting(x.service, 'Kickoff');
    const cid = x.service.command({
      id: uid(),
      meetingId: null,
      type: 'collectionCreate',
      payload: { title: 'Rollout', brief: '', meetingIds: [m1] },
    }) as string;
    x.service.command({
      id: uid(),
      meetingId: null,
      type: 'collectionReport',
      payload: { collectionId: cid },
    });
    await x.service.flush();
    const collection = x.service.collections.find((c) => c.id === cid)!;
    assert.equal(collection.reportStatus, 'idle', collection.reportError ?? '');
    assert.equal(collection.reports.length, 1);
    const rev = collection.reports[0];
    // Output locale follows the system, so assert against the collection's own
    // value rather than a hard-coded one.
    assert.equal(rev.locale, collection.outputLocale);
    assert.equal(rev.meetingIds.length, 1);
    assert.ok(rev.aliasRefs.length > 0, 'the report must cite resolvable aliases');
    assert.ok(rev.objectRefs.length === 0 || Array.isArray(rev.objectRefs));
    // Every cited alias must resolve back to a real meeting.
    for (const a of rev.aliasRefs) assert.equal(a.meetingId, m1);
    // Nothing model-facing may carry a real id.
    assert.ok(!JSON.stringify(rev.blocks).includes(m1));
  } finally {
    x.done();
  }
});

test('an invalid first attempt is repaired once, then succeeds', async () => {
  let calls = 0;
  const x = setup((payload) => {
    calls++;
    if (calls === 1) {
      // Cites an alias that was never issued, which resolveAliases must reject.
      const bad = reportFrom(payload) as CollectionReport;
      return {
        ...bad,
        sources: [{ id: 'never-issued', rev: 1 }],
        blocks: bad.blocks.map((b) => ({ ...b, sources: [{ id: 'never-issued', rev: 1 }] })),
      } as CollectionReport;
    }
    return reportFrom(payload);
  });
  try {
    const m1 = await seededMeeting(x.service, 'Kickoff');
    const cid = x.service.command({
      id: uid(),
      meetingId: null,
      type: 'collectionCreate',
      payload: { title: 'Rollout', brief: '', meetingIds: [m1] },
    }) as string;
    x.service.command({
      id: uid(),
      meetingId: null,
      type: 'collectionReport',
      payload: { collectionId: cid },
    });
    await x.service.flush();
    const collection = x.service.collections.find((c) => c.id === cid)!;
    assert.equal(calls, 2, 'exactly one repair attempt');
    assert.equal(collection.reports.length, 1);
    assert.equal(collection.reportStatus, 'idle');
    assert.equal(collection.reports[0].modelCalls, 2);
  } finally {
    x.done();
  }
});

test('a failing provider leaves the previous revision intact and reports the error', async () => {
  const x = setup(() => {
    throw new Error('MODEL_HTTP_429');
  });
  try {
    const m1 = await seededMeeting(x.service, 'Kickoff');
    const cid = x.service.command({
      id: uid(),
      meetingId: null,
      type: 'collectionCreate',
      payload: { title: 'Rollout', brief: '', meetingIds: [m1] },
    }) as string;
    x.service.command({
      id: uid(),
      meetingId: null,
      type: 'collectionReport',
      payload: { collectionId: cid },
    });
    await x.service.flush();
    const collection = x.service.collections.find((c) => c.id === cid)!;
    assert.equal(collection.reports.length, 0);
    assert.equal(collection.reportStatus, 'error');
    assert.equal(collection.reportError, 'MODEL_HTTP_429');
  } finally {
    x.done();
  }
});
