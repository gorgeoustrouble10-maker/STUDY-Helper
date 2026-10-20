import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createApplication } from "./server.mjs";

async function fixture(t, inviteCode = "test-invite") {
  const directory = mkdtempSync(path.join(tmpdir(), "garden-api-"));
  const app = createApplication({ directory, inviteCode });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}/api/mobile/v1`;
  async function call(route, data, token) {
    const r = await fetch(base + route, {
      method: data ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { status: r.status, ...(await r.json()) };
  }
  async function register(username = "alice") {
    return (
      await call("/auth/register", {
        username,
        password: "long-password-123",
        inviteCode,
      })
    ).data;
  }
  return { ...app, call, register };
}
const record = () => ({
  id: randomUUID(),
  kind: "NOTE",
  title: "测试笔记",
  body: "私密正文",
  status: "INBOX",
  fields: {},
  tags: [],
  links: [],
  deletedAt: null,
  archivedAt: null,
});
const op = (r, baseVersion = 0) => ({
  operationId: randomUUID(),
  baseVersion,
  record: r,
});

test("邀请码必须正确，失败不创建用户或会话；配置缺失关闭注册", async (t) => {
  const { call, db } = await fixture(t);
  for (const inviteCode of [undefined, "wrong", "TEST-INVITE"]) {
    assert.equal(
      (
        await call("/auth/register", {
          username: "alice",
          password: "long-password-123",
          inviteCode,
        })
      ).status,
      403,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
  }
  assert.equal(
    (
      await call("/auth/register", {
        username: "alice",
        password: "short",
        inviteCode: "test-invite",
      })
    ).status,
    400,
  );
  const closed = await fixture(t, "");
  assert.equal(
    (
      await closed.call("/auth/register", {
        username: "alice",
        password: "long-password-123",
        inviteCode: "test-invite",
      })
    ).status,
    503,
  );
});
test("注册、登录、刷新轮换、退出与重复账号", async (t) => {
  const { call, register } = await fixture(t);
  const first = await register();
  assert.ok(first.accessToken);
  assert.equal(
    (await call("/me", undefined, first.accessToken)).data.username,
    "alice",
  );
  assert.equal(
    (
      await call("/auth/register", {
        username: "ALICE",
        password: "long-password-123",
        inviteCode: "test-invite",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/auth/login", {
        username: "alice",
        password: "wrong-password",
      })
    ).status,
    401,
  );
  const login = await call("/auth/login", {
    username: "alice",
    password: "long-password-123",
  });
  assert.equal(login.status, 200);
  const renewed = await call("/auth/refresh", {
    refreshToken: first.refreshToken,
  });
  assert.equal(renewed.status, 200);
  assert.equal(
    (await call("/auth/refresh", { refreshToken: first.refreshToken })).status,
    401,
  );
  assert.equal((await call("/me", undefined, first.accessToken)).status, 401);
  assert.equal(
    (await call("/auth/logout", {}, renewed.data.accessToken)).status,
    200,
  );
  assert.equal(
    (await call("/me", undefined, renewed.data.accessToken)).status,
    401,
  );
});
test("同步幂等、冲突、删除与用户隔离", async (t) => {
  const { call, register, db } = await fixture(t),
    a = await register(),
    b = await register("bob");
  const r = record(),
    operation = op(r);
  const push = async (operations, token = a.accessToken) =>
    (await call("/sync/push", { operations }, token)).data.results;
  const result = (await push([operation]))[0];
  assert.equal(result.status, "ok");
  assert.equal(result.record.version, 1);
  assert.deepEqual((await push([operation]))[0], result);
  assert.equal(db.prepare("SELECT count(*) AS n FROM changes").get().n, 1);
  const conflict = (await push([op({ ...r, body: "旧窗口" }, 0)]))[0];
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.remote.body, r.body);
  assert.equal(
    (await call("/sync/pull?cursor=0", undefined, b.accessToken)).data.changes
      .length,
    0,
  );
  const foreign = record();
  foreign.links = [{ toId: r.id, relation: "related" }];
  assert.equal(
    (await push([op(foreign)], b.accessToken))[0].code,
    "INVALID_LINKS",
  );
  const deleted = (
    await push([
      op({ ...result.record, deletedAt: new Date().toISOString() }, 1),
    ])
  )[0];
  assert.equal(deleted.status, "ok");
  const pull = await call("/sync/pull?cursor=1", undefined, a.accessToken);
  assert.ok(pull.data.changes[0].record.deletedAt);
  assert.equal((await call("/sync/pull")).status, 401);
});
test("注册限速与同幂等键不同内容拒绝", async (t) => {
  const { call, register } = await fixture(t);
  const a = await register();
  const operation = op(record());
  await call("/sync/push", { operations: [operation] }, a.accessToken);
  const altered = structuredClone(operation);
  altered.record.body = "different";
  const result = await call(
    "/sync/push",
    { operations: [altered] },
    a.accessToken,
  );
  assert.equal(result.data.results[0].code, "OPERATION_REUSED");
  let last;
  for (let i = 0; i < 16; i++)
    last = await call("/auth/register", {
      username: "xx",
      password: "short",
      inviteCode: "wrong",
    });
  assert.equal(last.status, 429);
});

test("重复行动后继唯一且父行动不能循环", async t => {
  const {call,register,db}=await fixture(t);const user=await register();
  const push=async operation=>(await call('/sync/push',{operations:[operation]},user.accessToken)).data.results[0];
  const action={...record(),kind:'ACTION',status:'TODO',fields:{repeat:'MONTHLY',plannedAt:'2026-01-31T01:00:00.000Z'}};
  const created=await push(op(action));
  const completed=await push(op({...created.record,status:'DONE'},1));
  assert.equal(completed.status,'ok');
  let rows=db.prepare('SELECT doc FROM records WHERE user_id=?').all(user.user.id).map(r=>JSON.parse(r.doc));
  assert.equal(rows.filter(r=>r.fields.previousId===action.id).length,1);
  assert.equal(rows.find(r=>r.fields.previousId===action.id).fields.plannedAt,'2026-02-28T01:00:00.000Z');
  const february=rows.find(r=>r.fields.previousId===action.id);
  await push(op({...february,status:'DONE'},1));
  const march=db.prepare('SELECT doc FROM records WHERE user_id=?').all(user.user.id).map(r=>JSON.parse(r.doc)).find(r=>r.fields.previousId===february.id);
  assert.equal(march.fields.plannedAt,'2026-03-31T01:00:00.000Z');
  const reopened=await push(op({...completed.record,status:'TODO'},2));
  await push(op({...reopened.record,status:'DONE'},3));
  rows=db.prepare('SELECT doc FROM records WHERE user_id=?').all(user.user.id).map(r=>JSON.parse(r.doc));
  assert.equal(rows.filter(r=>r.fields.previousId===action.id).length,1);
  const parent={...record(),kind:'ACTION',status:'TODO'};
  const p=await push(op(parent));
  const child={...record(),kind:'ACTION',status:'TODO',fields:{parentId:parent.id}};
  const c=await push(op(child));assert.equal(c.status,'ok');
  const cycle=await push(op({...p.record,fields:{parentId:child.id}},1));
  assert.equal(cycle.code,'PARENT_CYCLE');
});
