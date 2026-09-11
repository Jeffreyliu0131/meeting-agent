import { DatabaseSync } from 'node:sqlite';
import { resolvePreferences } from '../domain/preferences';
import type { Meeting, Preferences } from '../contracts/model';
export const defaults: Preferences = {
  uiLanguage: 'system',
  defaultOutputLanguage: 'system',
  audio: {
    deviceId: 'default',
    deviceLabel: '',
    includeComputerAudio: false,
    setupCompleted: false,
  },
  uiLocale: 'en',
  defaultOutputLocale: 'en',
  reduceMotion: false,
  reduceTransparency: false,
  shortcut: '',
};
export interface StorePort {
  load(): { meetings: Meeting[]; preferences: Preferences };
  save(
    meetings: Meeting[],
    preferences: Preferences,
    command?: { id: string; hash: string; result: unknown },
  ): void;
  command(id: string): { hash: string; result: unknown } | null;
  close(): void;
}
export class SQLiteStore implements StorePort {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, hash TEXT NOT NULL, result TEXT NOT NULL);',
    );
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS workflow_jobs (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, batch_hash TEXT NOT NULL, fence INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_proposals (job_id TEXT PRIMARY KEY, hash TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_success (meeting_id TEXT NOT NULL, batch_hash TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE, PRIMARY KEY(meeting_id,batch_hash));`);
  }
  load() {
    const row = this.db.prepare('SELECT payload,schema_version FROM state WHERE id=1').get();
    if (!row)
      return {
        meetings: [],
        preferences: resolvePreferences(
          { ...defaults },
          process.env.MEETING_SYSTEM_LOCALE ?? Intl.DateTimeFormat().resolvedOptions().locale,
        ),
      };
    if (row.schema_version !== 1) throw new Error('STORAGE_VERSION');
    const state = JSON.parse(row.payload as string) as {
      meetings: Meeting[];
      preferences: Preferences;
    };
    state.preferences = resolvePreferences(
      state.preferences,
      process.env.MEETING_SYSTEM_LOCALE ?? Intl.DateTimeFormat().resolvedOptions().locale,
    );
    return state;
  }
  save(
    meetings: Meeting[],
    preferences: Preferences,
    command?: { id: string; hash: string; result: unknown },
  ) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          'INSERT INTO state(id,schema_version,payload) VALUES(1,1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        )
        .run(JSON.stringify({ meetings, preferences }));
      for (const meeting of meetings)
        for (const job of meeting.workflowJobs ?? []) {
          const previous = this.db
            .prepare('SELECT fence,status FROM workflow_jobs WHERE id=?')
            .get(job.id);
          if (
            previous &&
            (Number(previous.fence) > job.fence ||
              (previous.status === 'succeeded' && job.status !== 'succeeded'))
          )
            throw new Error('JOB_FENCED');
          if (job.proposal) {
            const payload = JSON.stringify(job.proposal);
            const old = this.db
              .prepare('SELECT hash,payload FROM workflow_proposals WHERE job_id=?')
              .get(job.id);
            if (old && (old.hash !== job.proposalHash || old.payload !== payload))
              throw new Error('PROPOSAL_MUTATED');
            this.db
              .prepare(
                'INSERT OR IGNORE INTO workflow_proposals(job_id,hash,payload) VALUES(?,?,?)',
              )
              .run(job.id, job.proposalHash!, payload);
          }
          this.db
            .prepare(
              'INSERT INTO workflow_jobs(id,meeting_id,batch_hash,fence,status,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fence=excluded.fence,status=excluded.status,payload=excluded.payload',
            )
            .run(job.id, meeting.id, job.hash, job.fence, job.status, JSON.stringify(job));
          if (job.status === 'succeeded') {
            const success = this.db
              .prepare('SELECT job_id FROM workflow_success WHERE meeting_id=? AND batch_hash=?')
              .get(meeting.id, job.hash);
            if (success && success.job_id !== job.id) throw new Error('DUPLICATE_BATCH_COMMIT');
            this.db
              .prepare(
                'INSERT OR IGNORE INTO workflow_success(meeting_id,batch_hash,job_id) VALUES(?,?,?)',
              )
              .run(meeting.id, job.hash, job.id);
          }
        }
      if (command)
        this.db
          .prepare('INSERT INTO commands(id,hash,result) VALUES(?,?,?)')
          .run(command.id, command.hash, JSON.stringify(command.result ?? null));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  command(id: string) {
    const row = this.db.prepare('SELECT hash,result FROM commands WHERE id=?').get(id);
    return row ? { hash: row.hash as string, result: JSON.parse(row.result as string) } : null;
  }
  close() {
    this.db.close();
  }
}
