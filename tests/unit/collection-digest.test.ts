import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectionDigest } from '../../src/domain/collection-digest';
import { classifyOpenItems } from '../../src/domain/closeout';
import type { Meeting, MeetingCollection, ObjectState } from '../../src/contracts/model';
/** `Meaning` is a zod schema, so the shape has to be inferred from ObjectState. */
type MeaningShape = NonNullable<ObjectState['meaning']>;

const meaning = (over: Partial<MeaningShape> = {}): MeaningShape => ({
  stance: 'asserted',
  conditionIds: [],
  owner: null,
  deadline: null,
  evidence: [],
  ...over,
});

function object(id: string, over: Partial<ObjectState> = {}): ObjectState {
  return {
    id,
    kind: 'claim',
    title: id,
    detail: '',
    origin: 'stated',
    status: 'unverified',
    sources: [],
    lifecycle: 'active',
    meaning: meaning(),
    rev: 1,
    ...over,
  } as ObjectState;
}

function meeting(id: string, over: Partial<Meeting> = {}): Meeting {
  return {
    id,
    title: id,
    status: 'ended',
    createdAt: '2026-09-01T00:00:00.000Z',
    revision: 1,
    languageRevision: 1,
    segments: [],
    objects: [],
    relations: [],
    decisions: [],
    inputGaps: [],
    ...over,
  } as unknown as Meeting;
}

function collection(meetingIds: string[], over: Partial<MeetingCollection> = {}): MeetingCollection {
  return {
    id: 'c1',
    title: 'Rollout',
    brief: 'Decide the pilot',
    meetingIds,
    outputLocale: 'zh-CN',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    reports: [],
    reportStatus: 'idle',
    reportError: null,
    ...over,
  };
}

const BUDGET = 32000;

test('a digest carries each member meeting and its open items', () => {
  const m1 = meeting('m1', {
    title: 'Kickoff',
    objects: [object('q1', { kind: 'question', title: 'Who owns support?' })],
  });
  const d = buildCollectionDigest(collection(['m1']), [m1], BUDGET);
  assert.equal(d.meetings.length, 1);
  assert.equal(d.meetings[0].alias, 'M1');
  assert.equal(d.meetings[0].label, 'Kickoff');
  assert.equal(d.open.length, 1);
  assert.equal(d.open[0].title, 'Who owns support?');
  assert.deepEqual(d.open[0].reason, ['unresolved']);
});

test('aliases are deterministic for identical input', () => {
  const m1 = meeting('m1', { objects: [object('a'), object('b', { kind: 'risk' })] });
  const m2 = meeting('m2', { objects: [object('c', { status: 'unknown' })] });
  const c = collection(['m1', 'm2']);
  const first = buildCollectionDigest(c, [m1, m2], BUDGET);
  const second = buildCollectionDigest(c, [m1, m2], BUDGET);
  assert.deepEqual(first.open.map((i) => i.alias), second.open.map((i) => i.alias));
  assert.deepEqual(Object.keys(first.aliasMap), Object.keys(second.aliasMap));
});

test('a digest never exposes a real meeting id to the model-facing fields', () => {
  // Human-readable titles MUST appear: the report has to name which meeting said
  // what. What must not appear is the internal identifier.
  const m1 = meeting('m-secret-9f3a', {
    title: 'Kickoff',
    objects: [object('o-secret-7b2c', { title: 'Pilot scope', kind: 'question' })],
  });
  const d = buildCollectionDigest(collection(['m-secret-9f3a']), [m1], BUDGET);
  const modelFacing = JSON.stringify({
    collection: d.collection,
    meetings: d.meetings.map(({ alias, label, date, state, gaps }) => ({
      alias,
      label,
      date,
      state,
      gaps,
    })),
    decisions: d.decisions,
    open: d.open,
    disputes: d.disputes,
    omitted: d.omitted,
  });
  assert.ok(!modelFacing.includes('m-secret-9f3a'), 'meeting id leaked');
  assert.ok(!modelFacing.includes('o-secret-7b2c'), 'object id leaked');
  assert.ok(modelFacing.includes('Kickoff'), 'the meeting must still be nameable');
  // The real ids exist only in the host-side alias map, which is never sent.
  assert.equal(d.aliasMap['o1'].meetingId, 'm-secret-9f3a');
  assert.equal(d.aliasMap['o1'].id, 'o-secret-7b2c');
});

test('a decision cited by a meeting appears once with its own meeting named', () => {
  const m1 = meeting('m1', {
    title: 'Review',
    decisions: [
      {
        id: 'd1',
        scope: 'meeting',
        artifact: { question: 'Scope?', summary: 'Internal pilot first' },
        basis: 'agreed in the room',
        participants: 'three attendees',
        sources: [],
        createdAt: '',
      } as never,
    ],
  });
  const d = buildCollectionDigest(collection(['m1']), [m1], BUDGET);
  assert.equal(d.decisions.length, 1);
  assert.equal(d.decisions[0].question, 'Scope?');
  assert.equal(d.decisions[0].meetingTitle, 'Review');
  assert.equal(d.decisions[0].basis, 'agreed in the room');
});

test('a personal decision is never promoted into a consolidated report', () => {
  const m1 = meeting('m1', {
    decisions: [
      { id: 'd1', scope: 'personal', artifact: {}, basis: '', participants: '', sources: [], createdAt: '' } as never,
    ],
  });
  assert.deepEqual(buildCollectionDigest(collection(['m1']), [m1], BUDGET).decisions, []);
});

test('the same topic left unresolved in two meetings is shown side by side', () => {
  const m1 = meeting('m1', {
    objects: [object('o1', { title: 'Pilot scope', meaning: meaning({ stance: 'asserted' }) })],
  });
  const m2 = meeting('m2', {
    objects: [object('o2', { title: 'pilot  scope!', meaning: meaning({ stance: 'proposed' }) })],
  });
  const d = buildCollectionDigest(collection(['m1', 'm2']), [m1, m2], BUDGET);
  const divergence = d.disputes.filter((x) => x.basis === 'title_stance_divergence');
  assert.equal(divergence.length, 1, 'punctuation and case must not hide the match');
  assert.equal(divergence[0].positions.length, 2);
  assert.deepEqual(
    divergence[0].positions.map((p) => p.stance).sort(),
    ['asserted', 'proposed'],
  );
});

test('a topic that agrees across meetings is not reported as a disagreement', () => {
  const m1 = meeting('m1', {
    objects: [object('o1', { title: 'Pilot scope', meaning: meaning({ stance: 'asserted' }) })],
  });
  const m2 = meeting('m2', {
    objects: [object('o2', { title: 'Pilot scope', meaning: meaning({ stance: 'asserted' }) })],
  });
  const d = buildCollectionDigest(collection(['m1', 'm2']), [m1, m2], BUDGET);
  assert.deepEqual(d.disputes, []);
});

test('an explicitly disputed item is reported with why it is disputed', () => {
  const m1 = meeting('m1', {
    objects: [object('o1', { title: 'Capacity', status: 'disputed' })],
  });
  const d = buildCollectionDigest(collection(['m1']), [m1], BUDGET);
  assert.equal(d.disputes.length, 1);
  assert.equal(d.disputes[0].basis, 'disputed_status');
});

test('a challenges relation pair is reported as a disagreement', () => {
  const m1 = meeting('m1', {
    objects: [object('o1', { title: 'Invite clients' }), object('o2', { title: 'Hold off' })],
    relations: [
      { id: 'r1', from: 'o1', to: 'o2', kind: 'challenges', sources: [], origin: 'stated' },
    ] as never,
  });
  const d = buildCollectionDigest(collection(['m1']), [m1], BUDGET);
  const challenges = d.disputes.filter((x) => x.basis === 'challenges_relation');
  assert.equal(challenges.length, 1);
  assert.equal(challenges[0].positions.length, 2);
});

test('an unreadably small budget fails loudly rather than trimming a disagreement', () => {
  const m1 = meeting('m1', {
    objects: [object('o1', { title: 'Capacity', status: 'disputed' })],
  });
  assert.throws(
    () => buildCollectionDigest(collection(['m1']), [m1], 40),
    /COLLECTION_CONTEXT_TOO_LARGE/,
  );
});

test('a tight budget degrades in order and reports what it dropped', () => {
  const objects = Array.from({ length: 40 }, (_, i) =>
    object(`o${i}`, {
      kind: 'question',
      title: `Open question number ${i} with a fairly long title to consume budget`,
      meaning: meaning({
        evidence: [
          { quote: 'a long quoted passage that eats bytes '.repeat(4), sources: [{ id: 's0', rev: 1 }] },
        ],
      }),
    }),
  );
  const m1 = meeting('m1', {
    objects,
    segments: [{ id: 's0', rev: 1, text: 'x' }] as never,
  });
  const full = buildCollectionDigest(collection(['m1']), [m1], 100000);
  assert.deepEqual(full.omitted, { openItems: 0, meetings: 0, quotes: 0 });
  const tight = buildCollectionDigest(collection(['m1']), [m1], 4000);
  assert.ok(tight.bytes <= 4000);
  const droppedTotal =
    tight.omitted.openItems + tight.omitted.meetings + tight.omitted.quotes;
  assert.ok(droppedTotal > 0, 'a tight budget must admit what it left out');
  assert.ok(tight.open.length < full.open.length || tight.omitted.quotes > 0);
});

test('only aliases the digest actually cites are retained', () => {
  const m1 = meeting('m1', {
    objects: [object('used', { kind: 'question' }), object('noise', { lifecycle: 'archived' })],
  });
  const d = buildCollectionDigest(collection(['m1']), [m1], BUDGET);
  const citedIds = d.aliasRefs.map((a) => a.id);
  assert.ok(citedIds.includes('used'));
  assert.ok(!citedIds.includes('noise'), 'an archived object is not cited and must not be kept');
});

test('classifyOpenItems works for a meeting that is still running', () => {
  const m = meeting('m1', {
    status: 'active',
    objects: [object('o1', { kind: 'task', meaning: meaning({ stance: 'proposed' }) })],
  });
  // classifyOpenItems has no ended-only gate; reconcileCloseout does.
  assert.deepEqual(classifyOpenItems(m).incompleteTaskIds, ['o1']);
  assert.equal(buildCollectionDigest(collection(['m1']), [m], BUDGET).open.length, 1);
});

test('a member that no longer exists is skipped, not silently replaced', () => {
  const d = buildCollectionDigest(collection(['gone']), [], BUDGET);
  assert.deepEqual(d.meetings, []);
  assert.deepEqual(d.open, []);
});
