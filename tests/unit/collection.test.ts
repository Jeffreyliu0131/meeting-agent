import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaults, SQLiteStore } from '../../src/service/store';
import { SessionService } from '../../src/service/session';
import { uid } from '../../src/domain/commands';
import { collectionReportStaleness, groupCitations } from '../../src/domain/collection';
import { MAX_COLLECTION_MEMBERS } from '../../src/contracts/model';
import type {
  CollectionReportRevision,
  Meeting,
  MeetingCollection,
} from '../../src/contracts/model';
import type { ModelPort, ProviderConfig } from '../../src/agent/provider';

const config: ProviderConfig = {
  key: '',
  base: 'https://api.openai.com/v1',
  model: 'test-double',
  sttKey: '',
  sttBase: 'https://api.openai.com/v1',
  sttModel: 'test-double',
  format: 'json_schema',
};
/** Collections never call the model, so an unreachable double is the honest one. */
const fake: ModelPort = {
  interpret: async () => {
    throw new Error('MODEL_NOT_CONFIGURED');
  },
};
/** Windows keeps a handle briefly after SQLite closes; retry rather than leak the dir. */
const cleanup = (dir: string) =>
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-collection-'));
  const path = join(dir, 'test.sqlite');
  let service = new SessionService(new SQLiteStore(path), fake, config);
  const meeting = (title: string) => {
    const id = service.command({
      id: uid(),
      meetingId: null,
      type: 'create',
      payload: { title, mode: 'manual', outputLocale: 'en', timezone: 'UTC' },
    }) as string;
    // Only one meeting may be active; the collection feature does not need it live.
    service.command({ id: uid(), meetingId: id, type: 'end', payload: {} });
    return id;
  };
  const command = (type: string, payload: Record<string, unknown>, id = uid()) =>
    service.command({ id, meetingId: null, type, payload });
  return {
    get service() {
      return service;
    },
    reload: () => {
      service.close();
      service = new SessionService(new SQLiteStore(path), fake, config);
      return service;
    },
    path,
    meeting,
    command,
    done: () => {
      service.close();
      cleanup(dir);
    },
  };
}

test('a collection and its members survive a restart', () => {
  const x = setup();
  try {
    const a = x.meeting('Kickoff'),
      b = x.meeting('Review');
    const id = x.command('collectionCreate', {
      title: 'Q3 rollout',
      brief: 'Decide the pilot scope',
      meetingIds: [a, b],
    }) as string;
    assert.ok(id);
    const restored = x.reload();
    assert.equal(restored.collections.length, 1);
    assert.equal(restored.collections[0].title, 'Q3 rollout');
    assert.equal(restored.collections[0].brief, 'Decide the pilot scope');
    assert.deepEqual(restored.collections[0].meetingIds, [a, b]);
    assert.deepEqual(restored.collections[0].reports, []);
  } finally {
    x.done();
  }
});

/** Writes a payload straight into a live store, bypassing save()'s own shape. */
function seedPayload(store: SQLiteStore, payload: unknown) {
  store.save([], { ...defaults });
  store.db.exec('BEGIN IMMEDIATE');
  store.db.prepare('UPDATE state SET payload=? WHERE id=1').run(JSON.stringify(payload));
  store.db.exec('COMMIT');
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}

test('a store written before collections existed loads with an empty list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-collection-legacy-'));
  const path = join(dir, 'test.sqlite');
  const store = new SQLiteStore(path);
  try {
    // Exactly what a build from before this feature would have written: valid
    // preferences, and no collections key at all.
    seedPayload(store, { meetings: [], preferences: { ...defaults } });
    assert.deepEqual(store.load().collections, []);
  } finally {
    store.close();
    cleanup(dir);
  }
});

test('a malformed collections value normalises instead of reaching the service', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-collection-malformed-'));
  const path = join(dir, 'test.sqlite');
  const store = new SQLiteStore(path);
  try {
    seedPayload(store, {
      meetings: [],
      preferences: { ...defaults },
      collections: { not: 'an array' },
    });
    assert.deepEqual(store.load().collections, []);
  } finally {
    store.close();
    cleanup(dir);
  }
});

test('collection commands are idempotent and reject a reused id with different content', () => {
  const x = setup();
  try {
    const a = x.meeting('Kickoff');
    const commandId = uid();
    const first = x.command(
      'collectionCreate',
      { title: 'Rollout', brief: '', meetingIds: [a] },
      commandId,
    );
    const replay = x.command(
      'collectionCreate',
      { title: 'Rollout', brief: '', meetingIds: [a] },
      commandId,
    );
    assert.equal(replay, first);
    assert.throws(
      () => x.command('collectionCreate', { title: 'Other', brief: '', meetingIds: [a] }, commandId),
      /IDEMPOTENCY_CONFLICT/,
    );
    assert.equal(x.service.collections.length, 1);
  } finally {
    x.done();
  }
});

test('editing a collection requires the revision it was based on', () => {
  const x = setup();
  try {
    const a = x.meeting('Kickoff'),
      b = x.meeting('Review');
    const id = x.command('collectionCreate', {
      title: 'Rollout',
      brief: '',
      meetingIds: [a],
    }) as string;
    assert.throws(
      () => x.command('collectionUpdate', { collectionId: id, baseRevision: 99, title: 'Stale' }),
      /REV_CONFLICT/,
    );
    x.command('collectionUpdate', { collectionId: id, baseRevision: 1, title: 'Renamed' });
    assert.equal(x.service.collections[0].title, 'Renamed');
    assert.equal(x.service.collections[0].revision, 2);
    x.command('collectionMembers', { collectionId: id, meetingIds: [a, b] });
    assert.deepEqual(x.service.collections[0].meetingIds, [a, b]);
  } finally {
    x.done();
  }
});

test('unknown meetings and unknown collections are refused rather than silently stored', () => {
  const x = setup();
  try {
    const a = x.meeting('Kickoff');
    assert.throws(
      () => x.command('collectionCreate', { title: 'X', brief: '', meetingIds: ['missing'] }),
      /COLLECTION_MEMBER_NOT_FOUND/,
    );
    assert.throws(
      () => x.command('collectionUpdate', { collectionId: 'missing', baseRevision: 1, title: 'X' }),
      /COLLECTION_NOT_FOUND/,
    );
    const id = x.command('collectionCreate', {
      title: 'Rollout',
      brief: '',
      meetingIds: [a],
    }) as string;
    assert.throws(
      () => x.command('collectionMembers', { collectionId: id, meetingIds: ['missing'] }),
      /COLLECTION_MEMBER_NOT_FOUND/,
    );
    assert.deepEqual(x.service.collections[0].meetingIds, [a]);
  } finally {
    x.done();
  }
});

test('a collection accepts at most the supported member ceiling', () => {
  const x = setup();
  try {
    const ids = Array.from({ length: MAX_COLLECTION_MEMBERS }, (_, i) => x.meeting(`M${i}`));
    const id = x.command('collectionCreate', {
      title: 'Full',
      brief: '',
      meetingIds: ids,
    }) as string;
    assert.ok(id);
    const extra = x.meeting('One more');
    assert.throws(
      () => x.command('collectionMembers', { collectionId: id, meetingIds: [...ids, extra] }),
      /too_big|TOO_BIG|invalid/i,
    );
  } finally {
    x.done();
  }
});

test('deleting a collection removes it and persists the removal', () => {
  const x = setup();
  try {
    const a = x.meeting('Kickoff');
    const id = x.command('collectionCreate', {
      title: 'Rollout',
      brief: '',
      meetingIds: [a],
    }) as string;
    x.command('collectionDelete', { collectionId: id });
    assert.equal(x.service.collections.length, 0);
    assert.equal(x.reload().collections.length, 0);
  } finally {
    x.done();
  }
});

test('a member meeting deleted elsewhere is dropped when the store reloads', () => {
  const x = setup();
  try {
    const a = x.meeting('Kickoff'),
      b = x.meeting('Review');
    const id = x.command('collectionCreate', {
      title: 'Rollout',
      brief: '',
      meetingIds: [a, b],
    }) as string;
    assert.ok(id);
    // Simulate the member disappearing while the collection was not loaded.
    const db = new DatabaseSync(x.path);
    const row = db.prepare('SELECT payload FROM state WHERE id=1').get() as { payload: string };
    const state = JSON.parse(row.payload);
    state.meetings = state.meetings.filter((m: Meeting) => m.id !== b);
    db.prepare('UPDATE state SET payload=? WHERE id=1').run(JSON.stringify(state));
    db.close();
    const restored = x.reload();
    assert.deepEqual(restored.collections[0].meetingIds, [a]);
  } finally {
    x.done();
  }
});

// --- staleness -------------------------------------------------------------

function report(overrides: Partial<CollectionReportRevision> = {}): CollectionReportRevision {
  return {
    id: 'rep',
    purposeKey: 'purpose',
    question: 'What is decided?',
    summary: '',
    layout: 'stack',
    objectIds: [],
    blocks: [{ id: 'b1', type: 'text', title: 'T', items: ['x'], sources: [], objectIds: [], origin: 'stated', status: 'unverified' }],
    formulas: [],
    sources: [],
    reportId: 'rep',
    rev: 1,
    generation: 1,
    locale: 'en',
    languageRevision: 1,
    inputVersion: 1,
    objectRefs: [],
    relationRefs: [],
    changedBlockIds: [],
    updateKind: 'create',
    createdAt: new Date().toISOString(),
    meetingIds: ['m1'],
    watermarks: [{ meetingId: 'm1', revision: 1, languageRevision: 1, inputVersion: 1 }],
    aliasMap: {},
    aliasRefs: [],
    digestHash: 'hash',
    omitted: { openItems: 0, meetings: 0, quotes: 0 },
    modelCalls: 1,
    ...overrides,
  };
}

function collection(overrides: Partial<MeetingCollection> = {}): MeetingCollection {
  return {
    id: 'c1',
    title: 'Rollout',
    brief: '',
    meetingIds: ['m1'],
    outputLocale: 'en',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    reports: [],
    reportStatus: 'idle',
    reportError: null,
    ...overrides,
  };
}

function meeting(id: string, overrides: Partial<Meeting> = {}): Meeting {
  return {
    id,
    revision: 1,
    languageRevision: 1,
    segments: [],
    objects: [],
    relations: [],
    ...overrides,
  } as unknown as Meeting;
}

test('a report is fresh when nothing it cited has moved', () => {
  const m = meeting('m1');
  assert.deepEqual(collectionReportStaleness(report(), collection(), [m]), []);
});

test('changing the member set marks the report stale', () => {
  const m = meeting('m1');
  const reasons = collectionReportStaleness(report(), collection({ meetingIds: ['m1', 'm2'] }), [m]);
  assert.ok(reasons.some((r) => r.kind === 'member_set_changed'));
});

test('a member that no longer exists is reported as missing, not as changed', () => {
  const reasons = collectionReportStaleness(report(), collection(), []);
  assert.ok(reasons.some((r) => r.kind === 'member_missing'));
  assert.ok(!reasons.some((r) => r.kind === 'meeting_changed'));
});

test('a member revision bump marks the report stale', () => {
  const m = meeting('m1', { revision: 2 });
  const reasons = collectionReportStaleness(report(), collection(), [m]);
  assert.ok(reasons.some((r) => r.kind === 'meeting_changed'));
});

test('a superseded citation is named precisely instead of only flagging the meeting', () => {
  const m = {
    id: 'm1',
    revision: 1,
    languageRevision: 1,
    segments: [{ id: 's1', rev: 3 }],
    objects: [],
    relations: [],
  } as unknown as Meeting;
  const r = report({
    aliasRefs: [{ alias: 's1', meetingAlias: 'M1', meetingId: 'm1', kind: 'source', id: 's1', rev: 2 }],
  });
  const reasons = collectionReportStaleness(r, collection(), [m]);
  assert.deepEqual(reasons, [
    { kind: 'citation_superseded', meetingId: 'm1', alias: 's1', was: 2, now: 3 },
  ]);
});

test('citations resolve back to the meeting that owns them, and unknown aliases are dropped', () => {
  const r = report({
    aliasMap: {
      s1: { alias: 's1', meetingAlias: 'M1', meetingId: 'm1', kind: 'source', id: 'real-1', rev: 2 },
      s2: { alias: 's2', meetingAlias: 'M2', meetingId: 'm2', kind: 'source', id: 'real-2', rev: 5 },
    },
  });
  const m1 = { id: 'm1', title: 'Kickoff' } as unknown as Meeting;
  const m2 = { id: 'm2', title: 'Review' } as unknown as Meeting;
  const groups = groupCitations(
    [
      { id: 's1', rev: 2 },
      { id: 's2', rev: 5 },
      { id: 'gone', rev: 1 },
    ],
    r,
    [m1, m2],
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0].meetingId, 'm1');
  assert.deepEqual(groups[0].refs, [{ id: 'real-1', rev: 2 }]);
  assert.equal(groups[1].meetingId, 'm2');
});
