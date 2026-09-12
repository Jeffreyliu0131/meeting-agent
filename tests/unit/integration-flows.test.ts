import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionService } from '../../src/service/session';
import { SQLiteStore, defaults } from '../../src/service/store';
import { applyCollaboration, validateCollaboration } from '../../src/domain/intent-preparation';
import { createMeeting } from '../../src/domain/commands';
import { buildCollectionDigest } from '../../src/domain/collection-digest';
import { collectionReportStaleness, groupCitations } from '../../src/domain/collection';
import type { DraftContent } from '../../src/contracts/intent-preparation';
import type { CollectionReport, Proposal } from '../../src/contracts/model';
import type { ModelPort } from '../../src/agent/provider';
const config = {
  key: '',
  base: 'https://example.invalid',
  model: 'synthetic',
  sttKey: '',
  sttBase: 'https://example.invalid',
  sttModel: 'gpt-live-transcribe',
  format: 'json_schema',
};
function setup(model: Partial<ModelPort> = {}) {
  const store = new SQLiteStore(':memory:');
  const service = new SessionService(
    store,
    {
      interpret: async () => {
        throw Error('UNEXPECTED_MODEL');
      },
      ...model,
    },
    config,
  );
  const id = service.command({
    id: crypto.randomUUID(),
    meetingId: null,
    type: 'create',
    payload: {
      title: 'Synthetic integration',
      mode: 'manual',
      outputLocale: 'en',
      timezone: 'UTC',
    },
  }) as string;
  const cmd = (type: string, payload: Record<string, unknown>, meetingId: string | null = id) =>
    service.command({ id: crypto.randomUUID(), meetingId, type, payload });
  const m = () => service.meetings.find((m) => m.id === id)!;
  return { service, store, id, cmd, m };
}
function prepare(x: ReturnType<typeof setup>, kind: DraftContent['kind'] = 'poll') {
  if (!x.m().intentPreparation?.enabled) x.cmd('collaborationEnable', { enabled: true });
  if (!x.m().segments.length)
    x.cmd('ingest', { text: 'Choose A or B. Alice owns API work on Friday.', kind: 'manual' });
  const m = x.m(),
    source = m.segments.at(-1)!,
    refs = [{ id: source.id, rev: source.rev }];
  m.processedSources = { [source.id]: source.rev };
  const content: Record<DraftContent['kind'], DraftContent> = {
    poll: {
      kind: 'poll',
      question: 'A or B?',
      selection: 'single',
      options: ['a', 'b'].map((key) => ({ key, label: key.toUpperCase(), sources: refs })),
    },
    assignment: {
      kind: 'assignment',
      items: [
        {
          key: 'task',
          task: 'API',
          deliverable: 'API',
          owner: 'Alice',
          time: 'Friday',
          dependencies: [],
          sources: refs,
        },
      ],
    },
    conflict: {
      kind: 'conflict',
      summary: 'Schedule needs review',
      sides: [{ key: 'side', description: 'Existing work', sources: refs }],
      questions: ['When?'],
      resolutions: ['Clarify availability'],
    },
    decision_confirmation: {
      kind: 'decision_confirmation',
      statement: 'Use A',
      scopeText: 'Pilot',
      conditions: ['Approval required'],
    },
  };
  const intent = {
    localId: kind,
    family: kind,
    operation: 'prepare',
    expression: 'explicit',
    resolution: 'actionable_draft',
    target: null,
    targetLocalId: null,
    topicRef: null,
    referencedObjects: [],
    evidence: refs,
    collectionMode: 'none',
    scopeText: kind,
    missingSlots: [],
    dependsOnLocalIds: [],
    content: content[kind],
  };
  const p = {
    objects: [],
    intentPreparation: { intents: [intent], coverage: 'complete', unprocessedRefs: [] },
  } as unknown as Proposal;
  validateCollaboration(p, m);
  applyCollaboration(m, p, refs, crypto.randomUUID());
  return m.intentPreparation!.drafts.at(-1)!;
}
const report = (source: string): CollectionReport =>
  ({
    id: 'new_report',
    purposeKey: 'report',
    question: 'Recorded decisions',
    summary: 'Recorded scoped decision',
    layout: 'stack',
    objectIds: [],
    blocks: [
      {
        id: 'b1',
        type: 'text',
        title: 'Decision',
        items: ['Use A'],
        sources: [{ id: source, rev: 1 }],
        objectIds: [],
        origin: 'stated',
        status: 'unverified',
      },
    ],
    formulas: [],
    sources: [{ id: source, rev: 1 }],
  }) as CollectionReport;

test('four private families transfer into native previews without publishing or guessing identities', async () => {
  const x = setup();
  try {
    for (const kind of ['poll', 'assignment', 'conflict', 'decision_confirmation'] as const) {
      const d = prepare(x, kind);
      const id = x.cmd('collaborationPromote', { draftId: d.id, expectedRevision: d.rev });
      await x.service.flush();
      const c = x.m().collaboration!.components.find((c) => c.id === id)!;
      assert.equal(c.family, kind);
      assert.equal(c.rounds.length, 0);
      assert.equal(x.cmd('collaborationPromote', { draftId: d.id, expectedRevision: d.rev }), id);
      if (c.family === 'assignment' && c.revisions[0].content.kind === 'assignment') {
        const task = c.revisions[0].content.payload.items[0];
        assert.equal(task.assigneeId, null);
        assert.equal(task.unresolvedAssigneeText, 'Alice');
        assert.equal(task.schedule.rawText, 'Friday');
      }
    }
    assert.equal(x.m().intentPreparation!.drafts.length, 4);
    assert.equal(x.m().collaboration!.decisions.length, 0);
    assert.equal(x.store.load().meetings[0].intentPreparation!.drafts.length, 4);
  } finally {
    x.service.close();
  }
});

test('native edits and source corrections cannot be overwritten by re-promoting an older intent', async () => {
  const x = setup();
  try {
    const d = prepare(x);
    const id = x.cmd('collaborationPromote', { draftId: d.id, expectedRevision: d.rev });
    await x.service.flush();
    const state = x.m().collaboration!,
      c = state.components.find((c) => c.id === id)!;
    const content = structuredClone(c.revisions.at(-1)!.content);
    if (content.kind !== 'poll') throw Error();
    content.payload.question = 'Manually confirmed wording';
    x.service.collaborate(
      {
        id: crypto.randomUUID(),
        meetingId: x.id,
        type: 'component.edit_draft',
        payload: { componentId: id, baseDraftRevision: c.draftRevision, content },
      },
      state.participants[0].id,
    );
    await x.service.flush();
    x.cmd('collaborationEdit', {
      draftId: d.id,
      expectedRevision: d.rev,
      path: 'question',
      value: 'New private wording',
    });
    const fresh = x.m().intentPreparation!.drafts[0];
    assert.throws(
      () => x.cmd('collaborationPromote', { draftId: fresh.id, expectedRevision: fresh.rev }),
      /COMPONENT_EDITED/,
    );
    const source = x.m().segments[0];
    x.cmd('correct', { segmentId: source.id, baseRevision: source.rev, text: 'Only A remains' });
    assert.throws(
      () => x.cmd('collaborationPromote', { draftId: fresh.id, expectedRevision: fresh.rev }),
      /DEPENDENCY_STALE/,
    );
  } finally {
    x.service.close();
  }
});

test('collections survive collaboration, audio bookkeeping and saved-state reload', async () => {
  const x = setup();
  try {
    const cid = x.cmd('collectionCreate', { title: 'Topic', meetingIds: [x.id] }, null);
    const d = prepare(x);
    x.cmd('collaborationPromote', { draftId: d.id, expectedRevision: d.rev });
    await x.service.flush();
    x.service.audioQueueChanged(0, x.id);
    x.service.enableCollaboration(x.id, ['A']);
    assert.equal(x.store.load().collections[0].id, cid);
    assert.equal(x.store.load().meetings[0].collaboration!.components.length, 1);
  } finally {
    x.service.close();
  }
});

test('legacy FTY state migrates to private preparation without becoming native collaboration', () => {
  const m = createMeeting(
    { title: 'Legacy synthetic', mode: 'manual', outputLocale: 'en', timezone: 'UTC' },
    defaults,
  );
  const legacy = {
    enabled: true,
    revision: 3,
    drafts: [],
    processedEvents: ['old'],
    coverage: 'complete',
    unprocessedRefs: [],
  };
  const store = new SQLiteStore(':memory:');
  store.db
    .prepare('INSERT INTO state(id,schema_version,payload) VALUES(1,1,?)')
    .run(JSON.stringify({ meetings: [{ ...m, collaboration: legacy }], preferences: defaults }));
  const service = new SessionService(
    store,
    {
      interpret: async () => {
        throw Error('UNEXPECTED_MODEL');
      },
    },
    config,
  );
  try {
    assert.deepEqual(service.meetings[0].intentPreparation, legacy);
    assert.equal(service.meetings[0].collaboration, undefined);
    assert.deepEqual(store.load().meetings[0].intentPreparation, legacy);
  } finally {
    service.close();
  }
});

test('a scoped collaboration decision feeds a collection report as business evidence, not a transcript', async () => {
  const x = setup({
    synthesize: async (payload: any) => ({
      report: report(payload.decisions[0].sources[0]),
      inputTokens: 1,
      outputTokens: 1,
      usageKnown: true,
    }),
  });
  try {
    x.service.enableCollaboration(x.id, ['A']);
    const s = x.m().collaboration!;
    const content = {
      kind: 'decision_confirmation',
      payload: {
        statement: 'Use A',
        scopeText: 'Pilot A',
        conditions: [],
        targetObjectRefs: [],
        supportingResults: [],
        requiredParticipantIds: [],
        rule: 'all_required_explicit_agree',
      },
    };
    const action = (type: string, payload: any, actor = s.participants[0].id) =>
      x.service.collaborate({ id: crypto.randomUUID(), meetingId: x.id, type, payload }, actor);
    const id = action('component.prepare', { content });
    await x.service.flush();
    let c = x.m().collaboration!.components[0];
    action('component.publish', {
      componentId: id,
      draftRevision: c.draftRevision,
      expectedAggregateVersion: c.aggregateVersion,
      audienceIds: [s.participants[1].id],
      sourceDisclosure: [],
    });
    await x.service.flush();
    c = x.m().collaboration!.components[0];
    action(
      'component.respond',
      {
        componentId: id,
        publishedRevision: c.publishedRevision,
        expectedResponseVersion: 0,
        response: { kind: 'agree' },
      },
      s.participants[1].id,
    );
    await x.service.flush();
    c = x.m().collaboration!.components[0];
    action('component.record_decision', {
      componentId: id,
      publishedRevision: c.publishedRevision,
      expectedAggregateVersion: c.aggregateVersion,
    });
    const cid = x.cmd(
      'collectionCreate',
      { title: 'Pilot reports', meetingIds: [x.id] },
      null,
    ) as string;
    x.cmd('collectionReport', { collectionId: cid }, null);
    await x.service.flush();
    const collection = x.service.collections[0];
    assert.equal(collection.reportError, null);
    assert.equal(collection.reports.length, 1);
    assert.equal(x.m().segments.length, 0);
    assert.equal(
      buildCollectionDigest(collection, x.service.meetings).decisions[0].summary,
      'Use A',
    );
    const r = collection.reports[0];
    assert.equal(r.aliasRefs[0].kind, 'decision');
    assert.equal(collectionReportStaleness(r, collection, x.service.meetings).length, 0);
    assert.deepEqual(groupCitations(r.sources, r, x.service.meetings)[0].refs, []);
    x.cmd(
      'collectionUpdate',
      { collectionId: cid, baseRevision: collection.revision, brief: 'Now compare costs' },
      null,
    );
    assert.ok(collectionReportStaleness(r, x.service.collections[0], x.service.meetings).length);
  } finally {
    x.service.close();
  }
});

for (const mutate of ['collection', 'source'] as const)
  test(`report rejects ${mutate} changes during generation without claiming a new baseline`, async () => {
    let resolveModel!: (value: any) => void, started!: () => void;
    const began = new Promise<void>((r) => (started = r));
    const x = setup({
      synthesize: async () => {
        started();
        return new Promise((r) => (resolveModel = r));
      },
    });
    try {
      const d = prepare(x);
      const m = x.m();
      // A genuine recorded artifact decision gives the digest an explicit, traceable source.
      m.decisions.push({
        id: 'decision',
        scope: 'meeting',
        artifact: { question: 'A or B', summary: 'Use A' },
        basis: 'Explicit confirmation',
        participants: 'A',
        sources: d.sources,
      } as any);
      const cid = x.cmd(
        'collectionCreate',
        { title: 'Reports', meetingIds: [x.id] },
        null,
      ) as string;
      x.cmd('collectionReport', { collectionId: cid }, null);
      await began;
      if (mutate === 'collection')
        x.cmd(
          'collectionUpdate',
          {
            collectionId: cid,
            baseRevision: x.service.collections[0].revision,
            title: 'Changed topic',
          },
          null,
        );
      else {
        const source = x.m().segments[0];
        x.cmd('correct', {
          segmentId: source.id,
          baseRevision: source.rev,
          text: 'Only B remains',
        });
      }
      resolveModel({ report: report('d1'), inputTokens: 1, outputTokens: 1 });
      await x.service.flush();
      assert.equal(x.service.collections[0].reportError, 'COLLECTION_CHANGED');
      assert.equal(x.service.collections[0].reports.length, 0);
    } finally {
      x.service.close();
    }
  });
