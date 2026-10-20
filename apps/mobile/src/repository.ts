import type { Kind } from "./definitions";

export type RecordData = {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  status: string;
  fields: Record<string, unknown>;
  tags: string[];
  links: { toId: string; relation: string }[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  version: number;
};
export type Stored = {
  id: string;
  payload: string;
  revision: number;
  server_version: number;
  dirty: number;
  conflict: string | null;
};
export type LocalRecord = RecordData & {
  dirty: boolean;
  conflict: RecordData | null;
};
export type Pending = {
  id: string;
  operationId: string;
  baseVersion: number;
  payload: string;
  revision: number;
};
export interface Connection {
  execSync(sql: string): void;
  runSync(sql: string, ...params: (string | number | null)[]): unknown;
  getFirstSync<T>(sql: string, ...params: (string | number | null)[]): T | null;
  getAllSync<T>(sql: string, ...params: (string | number | null)[]): T[];
  withTransactionSync(work: () => void): void;
  closeSync(): void;
}
export class Repository {
  db: Connection;
  createId: () => string;
  constructor(
    userId: string,
    openDatabase: (name: string) => Connection,
    createId: () => string,
  ) {
    this.createId = createId;
    if (!/^[a-zA-Z0-9-]+$/.test(userId)) throw new Error("账号标识无效");
    this.db = openDatabase(`garden-${userId}.db`);
    this.db.execSync(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,payload TEXT NOT NULL,revision INTEGER NOT NULL,server_version INTEGER NOT NULL,dirty INTEGER NOT NULL,conflict TEXT);
      CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY,operationId TEXT NOT NULL,baseVersion INTEGER NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  list(): LocalRecord[] {
    return this.db
      .getAllSync<Stored>("SELECT * FROM records")
      .map((r) => ({
        ...JSON.parse(r.payload),
        dirty: !!r.dirty,
        conflict: r.conflict ? JSON.parse(r.conflict) : null,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  aiCache<T>(key: string): T | null {
    const row = this.db.getFirstSync<{ value: string }>(
      "SELECT value FROM meta WHERE key=?",
      `ai:${key}`,
    );
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }
  storeAiCache(key: string, value: unknown) {
    if (value === null)
      this.db.runSync("DELETE FROM meta WHERE key=?", `ai:${key}`);
    else
      this.db.runSync(
        "INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        `ai:${key}`,
        JSON.stringify(value),
      );
  }
  save(value: RecordData) {
    this.db.withTransactionSync(() => {
      const current = this.db.getFirstSync<Stored>(
        "SELECT * FROM records WHERE id=?",
        value.id,
      );
      this.db.runSync(
        "INSERT INTO records VALUES(?,?,?,?,1,NULL) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,dirty=1",
        value.id,
        JSON.stringify({ ...value, updatedAt: new Date().toISOString() }),
        (current?.revision || 0) + 1,
        current?.server_version || 0,
      );
    });
  }
  prepare(): Pending[] {
    this.db.withTransactionSync(() => {
      for (const r of this.db.getAllSync<Stored>(
        "SELECT * FROM records WHERE dirty=1 AND conflict IS NULL ORDER BY rowid LIMIT 30",
      )) {
        this.db.runSync(
          "INSERT OR IGNORE INTO pending VALUES(?,?,?,?,?)",
          r.id,
          this.createId(),
          r.server_version,
          r.payload,
          r.revision,
        );
      }
    });
    return this.db.getAllSync<Pending>(
      "SELECT * FROM pending ORDER BY rowid LIMIT 30",
    );
  }
  acknowledge(pending: Pending, remote: RecordData) {
    this.db.withTransactionSync(() => {
      const row = this.db.getFirstSync<Stored>(
        "SELECT * FROM records WHERE id=?",
        pending.id,
      );
      if (!row) return;
      const unchanged = row.revision === pending.revision;
      this.db.runSync(
        "UPDATE records SET payload=?,server_version=?,dirty=?,conflict=NULL WHERE id=?",
        unchanged ? JSON.stringify(remote) : row.payload,
        remote.version,
        unchanged ? 0 : 1,
        pending.id,
      );
      this.db.runSync("DELETE FROM pending WHERE id=?", pending.id);
    });
  }
  conflict(id: string, remote: RecordData) {
    this.db.withTransactionSync(() => {
      this.db.runSync(
        "UPDATE records SET conflict=? WHERE id=?",
        JSON.stringify(remote),
        id,
      );
      this.db.runSync("DELETE FROM pending WHERE id=?", id);
    });
  }
  apply(remote: RecordData) {
    const row = this.db.getFirstSync<Stored>(
      "SELECT * FROM records WHERE id=?",
      remote.id,
    );
    if (row && remote.version <= row.server_version) return;
    if (row?.dirty) {
      this.db.runSync(
        "UPDATE records SET conflict=? WHERE id=?",
        JSON.stringify(remote),
        remote.id,
      );
      this.db.runSync("DELETE FROM pending WHERE id=?", remote.id);
      return;
    }
    this.db.runSync(
      "INSERT INTO records VALUES(?,?,1,?,0,NULL) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,server_version=excluded.server_version,dirty=0,conflict=NULL",
      remote.id,
      JSON.stringify(remote),
      remote.version,
    );
  }
  resolve(id: string, useLocal: boolean) {
    const row = this.db.getFirstSync<Stored>(
      "SELECT * FROM records WHERE id=?",
      id,
    );
    if (!row?.conflict) return;
    const remote: RecordData = JSON.parse(row.conflict);
    this.db.withTransactionSync(() => {
      this.db.runSync(
        "UPDATE records SET payload=?,server_version=?,dirty=?,revision=revision+1,conflict=NULL WHERE id=?",
        useLocal ? row.payload : JSON.stringify(remote),
        remote.version,
        useLocal ? 1 : 0,
        id,
      );
      this.db.runSync("DELETE FROM pending WHERE id=?", id);
    });
  }
  reject(id: string) {
    this.db.runSync("DELETE FROM pending WHERE id=?", id);
  }
  cursor() {
    return Number(
      this.db.getFirstSync<{ value: string }>(
        "SELECT value FROM meta WHERE key=?",
        "cursor",
      )?.value || 0,
    );
  }
  draft(id: string) {
    const r = this.db.getFirstSync<{ payload: string }>(
      "SELECT payload FROM drafts WHERE id=?",
      id,
    );
    return r ? JSON.parse(r.payload) : null;
  }
  storeDraft(id: string, value: unknown) {
    this.db.runSync(
      "INSERT INTO drafts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      id,
      JSON.stringify(value),
    );
  }
  clearDraft(id: string) {
    this.db.runSync("DELETE FROM drafts WHERE id=?", id);
  }
  page(changes: { record: RecordData }[], cursor: number) {
    this.db.withTransactionSync(() => {
      changes.forEach((v) => this.apply(v.record));
      this.db.runSync(
        "INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        "cursor",
        String(cursor),
      );
    });
  }
  close() {
    this.db.closeSync();
  }
}
