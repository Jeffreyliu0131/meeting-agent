import type { DatabaseSync } from 'node:sqlite';
import type { CollaborationState, Component } from '../contracts/collaboration';

const tables = [
  'meta',
  'participants',
  'components',
  'revisions',
  'rounds',
  'responses',
  'conflicts',
  'events',
  'receipts',
  'decisions',
  'jobs',
] as const;
export function initializeCollaborationStore(db: DatabaseSync) {
  for (const table of tables)
    db.exec(
      `CREATE TABLE IF NOT EXISTS collaboration_${table} (meeting_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(meeting_id,id));`,
    );
}
function put(
  db: DatabaseSync,
  table: (typeof tables)[number],
  meetingId: string,
  id: string,
  value: unknown,
  immutable = false,
) {
  const payload = JSON.stringify(value);
  const previous = db
    .prepare(`SELECT payload FROM collaboration_${table} WHERE meeting_id=? AND id=?`)
    .get(meetingId, id);
  if (previous?.payload === payload) return;
  if (previous && immutable) throw new Error('COLLABORATION_RECORD_MUTATED');
  db.prepare(
    `INSERT INTO collaboration_${table}(meeting_id,id,payload) VALUES(?,?,?) ON CONFLICT(meeting_id,id) DO UPDATE SET payload=excluded.payload`,
  ).run(meetingId, id, payload);
}
/** Called inside SQLiteStore's existing transaction; never starts a nested transaction. */
export function writeCollaboration(db: DatabaseSync, s: CollaborationState) {
  const {
    participants,
    components,
    responses,
    conflicts,
    events,
    receipts,
    decisions,
    jobs,
    ...meta
  } = s;
  put(db, 'meta', s.meetingId, 'state', meta);
  for (const p of participants) put(db, 'participants', s.meetingId, p.id, p);
  for (const c of components) {
    const { revisions, rounds, ...control } = c;
    put(db, 'components', s.meetingId, c.id, control);
    for (const r of revisions)
      put(
        db,
        'revisions',
        s.meetingId,
        `${c.id}:${r.revision}`,
        { componentId: c.id, value: r },
        true,
      );
    for (const r of rounds)
      put(db, 'rounds', s.meetingId, `${c.id}:${r.revision}`, { componentId: c.id, value: r });
  }
  for (const r of responses) put(db, 'responses', s.meetingId, r.id, r);
  for (const f of conflicts) put(db, 'conflicts', s.meetingId, f.id, f);
  for (const e of events) put(db, 'events', s.meetingId, e.id, e, true);
  for (const r of receipts) put(db, 'receipts', s.meetingId, `${r.eventId}:${r.participantId}`, r);
  for (const d of decisions) put(db, 'decisions', s.meetingId, d.id, d);
  for (const j of jobs) put(db, 'jobs', s.meetingId, j.id, j);
}
export function loadCollaboration(
  db: DatabaseSync,
  meetingId: string,
): CollaborationState | undefined {
  const row = db
    .prepare('SELECT payload FROM collaboration_meta WHERE meeting_id=? AND id=?')
    .get(meetingId, 'state');
  if (!row) return;
  const meta = JSON.parse(row.payload as string);
  if (meta.schemaVersion !== 1) throw new Error('COLLABORATION_SCHEMA_VERSION');
  const read = (table: (typeof tables)[number]): any[] =>
    db
      .prepare(`SELECT payload FROM collaboration_${table} WHERE meeting_id=? ORDER BY rowid`)
      .all(meetingId)
      .map((r) => JSON.parse(r.payload as string));
  const revisions = read('revisions'),
    rounds = read('rounds');
  const components: Component[] = read('components').map((c) => ({
    ...c,
    revisions: revisions
      .filter((r) => r.componentId === c.id)
      .map((r) => r.value)
      .sort((a, b) => a.revision - b.revision),
    rounds: rounds
      .filter((r) => r.componentId === c.id)
      .map((r) => r.value)
      .sort((a, b) => a.revision - b.revision),
  }));
  return {
    ...meta,
    participants: read('participants'),
    components,
    responses: read('responses'),
    conflicts: read('conflicts'),
    events: read('events').sort((a, b) => a.sequence - b.sequence),
    receipts: read('receipts'),
    decisions: read('decisions'),
    jobs: read('jobs'),
  };
}
