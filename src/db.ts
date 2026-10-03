import crypto from "node:crypto";
import Database from "better-sqlite3";

export const now = () => Date.now();
export const id = (prefix = "") => prefix + crypto.randomBytes(9).toString("base64url");
export const json = (v: unknown) => JSON.stringify(v ?? null);
export const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return (JSON.parse(v) ?? fallback) as T;
  } catch {
    return fallback;
  }
};

const MIGRATIONS = [
  `
CREATE TABLE threads(
  id TEXT PRIMARY KEY, title TEXT NOT NULL, main INTEGER NOT NULL DEFAULT 0,
  session_id TEXT, created_at INTEGER NOT NULL, last_message_at INTEGER NOT NULL, seen_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE messages(
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
  created_at INTEGER NOT NULL, status TEXT, read_at INTEGER, reply_to TEXT, attachments TEXT, reactions TEXT NOT NULL DEFAULT '[]',
  task TEXT, approval TEXT, source TEXT
);
CREATE INDEX messages_thread ON messages(thread_id, created_at);
CREATE TABLE runs(
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, thread_id TEXT, status TEXT NOT NULL,
  model TEXT NOT NULL, effort TEXT NOT NULL, started_at INTEGER, ended_at INTEGER, created_at INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '', tokens INTEGER NOT NULL DEFAULT 0, prompt TEXT NOT NULL DEFAULT '',
  message_id TEXT, surfaced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX runs_created ON runs(created_at);
CREATE TABLE run_log(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, at INTEGER NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL);
CREATE INDEX run_log_run ON run_log(run_id);
CREATE TABLE schedules(
  id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, builtin TEXT, cron TEXT, at INTEGER, timezone TEXT NOT NULL,
  prompt TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, next_at INTEGER, last_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE approvals(
  id TEXT PRIMARY KEY, run_id TEXT, thread_id TEXT NOT NULL, message_id TEXT NOT NULL, tool TEXT NOT NULL, input TEXT NOT NULL,
  status TEXT NOT NULL, created_at INTEGER NOT NULL, resolved_at INTEGER
);
CREATE TABLE goals(
  id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, why TEXT NOT NULL DEFAULT '', plan TEXT NOT NULL DEFAULT '[]',
  progress REAL NOT NULL DEFAULT 0, checkin TEXT, last_checkin_at INTEGER, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE TABLE ideas(id TEXT PRIMARY KEY, title TEXT NOT NULL, why TEXT NOT NULL, prompt TEXT NOT NULL, created_at INTEGER NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE cards(
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, actions TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE uploads(id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE push_subs(endpoint TEXT PRIMARY KEY, sub TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
`,
  `ALTER TABLE messages ADD COLUMN client_id TEXT;`,
];

export class Store {
  readonly db: Database.Database;
  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    const version = this.db.pragma("user_version", { simple: true }) as number;
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.db.exec(MIGRATIONS[i]);
      this.db.pragma(`user_version = ${i + 1}`);
    }
  }
  run(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).run(...args);
  }
  get<T = any>(sql: string, ...args: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }
  all<T = any>(sql: string, ...args: unknown[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }
  kv<T>(key: string, fallback: T): T {
    const row = this.get<{ value: string }>("SELECT value FROM kv WHERE key=?", key);
    return row ? parse(row.value, fallback) : fallback;
  }
  setKv(key: string, value: unknown) {
    this.run("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, json(value));
  }
  close() {
    this.db.close();
  }
}
