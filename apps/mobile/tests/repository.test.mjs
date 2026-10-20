import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Repository } from "../src/repository.ts";
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  const adapter = {
    execSync: (s) => db.exec(s),
    runSync: (s, ...p) => db.prepare(s).run(...p),
    getFirstSync: (s, ...p) => db.prepare(s).get(...p) || null,
    getAllSync: (s, ...p) => db.prepare(s).all(...p),
    withTransactionSync: (fn) => {
      db.exec("BEGIN");
      try {
        fn();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    closeSync: () => db.close(),
  };
  const repo = new Repository("test-user", () => adapter, randomUUID);
  t.after(() => repo.close());
  return repo;
}
const note = () => ({
  id: randomUUID(),
  kind: "NOTE",
  title: "本地笔记",
  body: "第一版",
  status: "INBOX",
  fields: {},
  tags: [],
  links: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  version: 0,
  deletedAt: null,
  archivedAt: null,
});
test("编辑和待提交队列持久一致；重试使用相同操作ID", (t) => {
  const repo = fixture(t),
    r = note();
  repo.save(r);
  const pending = repo.prepare()[0];
  assert.equal(repo.list()[0].dirty, true);
  assert.deepEqual(repo.prepare()[0], pending);
  repo.acknowledge(pending, { ...r, version: 1 });
  assert.equal(repo.list()[0].dirty, false);
  assert.equal(repo.prepare().length, 0);
});
test("发送过程中继续编辑，旧确认不能覆盖新输入", (t) => {
  const repo = fixture(t),
    r = note();
  repo.save(r);
  const pending = repo.prepare()[0];
  repo.save({ ...r, body: "刚输入的新内容" });
  assert.equal(repo.prepare()[0].payload, pending.payload);
  repo.acknowledge(pending, { ...r, version: 1 });
  assert.equal(repo.list()[0].body, "刚输入的新内容");
  assert.equal(repo.list()[0].dirty, true);
  const next = repo.prepare()[0];
  assert.equal(next.baseVersion, 1);
  assert.notEqual(next.operationId, pending.operationId);
});
test("远端与未提交输入冲突，游标与冲突原子更新，用户选择解决", (t) => {
  const repo = fixture(t),
    r = note();
  repo.save(r);
  repo.page([{ record: { ...r, body: "另一设备", version: 1 } }], 1);
  assert.equal(repo.cursor(), 1);
  assert.equal(repo.list()[0].body, "第一版");
  assert.equal(repo.list()[0].conflict.body, "另一设备");
  assert.equal(repo.prepare().length, 0);
  repo.resolve(r.id, true);
  assert.equal(repo.prepare()[0].baseVersion, 1);
  assert.equal(repo.list()[0].conflict, null);
});
test("较旧拉取不覆盖确认结果；草稿保存与清除独立", (t) => {
  const repo = fixture(t),
    r = note();
  repo.save(r);
  const p = repo.prepare()[0];
  repo.acknowledge(p, { ...r, body: "最新云端", version: 3 });
  repo.page([{ record: { ...r, version: 2 } }], 8);
  assert.equal(repo.list()[0].body, "最新云端");
  repo.storeDraft(r.id, { ...r, body: "未保存草稿" });
  assert.equal(repo.draft(r.id).body, "未保存草稿");
  repo.clearDraft(r.id);
  assert.equal(repo.draft(r.id), null);
});
test("AI 历史与在途请求重启后保留，按账号隔离且不进入记录同步队列", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "garden-ai-cache-"));
  const open = (name) => {
    const db = new DatabaseSync(path.join(directory, name));
    return {
      execSync: (s) => db.exec(s),
      runSync: (s, ...p) => db.prepare(s).run(...p),
      getFirstSync: (s, ...p) => db.prepare(s).get(...p) || null,
      getAllSync: (s, ...p) => db.prepare(s).all(...p),
      withTransactionSync: (fn) => {
        db.exec("BEGIN");
        try {
          fn();
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
      closeSync: () => db.close(),
    };
  };
  let a = new Repository("user-alice", open, randomUUID);
  const pending = {
    requestId: randomUUID(),
    conversationId: randomUUID(),
    message: "上次提问",
    contextRecordIds: [],
  };
  a.storeAiCache("pending", pending);
  a.storeAiCache("list", [{ id: pending.conversationId, title: "历史会话" }]);
  a.close();
  a = new Repository("user-alice", open, randomUUID);
  const b = new Repository("user-bob", open, randomUUID);
  t.after(() => {
    a.close();
    b.close();
    rmSync(directory, { recursive: true });
  });
  assert.deepEqual(a.aiCache("pending"), pending);
  assert.equal(a.aiCache("list")[0].title, "历史会话");
  assert.equal(b.aiCache("pending"), null);
  assert.equal(b.aiCache("list"), null);
  assert.equal(a.prepare().length, 0);
  a.storeAiCache("pending", null);
  assert.equal(a.aiCache("pending"), null);
  assert.equal(a.aiCache("list").length, 1);
});
