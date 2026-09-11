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
