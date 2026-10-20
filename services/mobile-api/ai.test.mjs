import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createApplication } from "./server.mjs";
import { readAiConfig } from "./ai.mjs";

const config = {
  provider: "deepseek",
  model: "test-model",
  baseURL: "https://model.test/v1",
  apiKey: "server-only-secret",
};
const answer = (content) =>
  new Response(
    JSON.stringify({
      choices: [
        { message: { role: "assistant", content }, finish_reason: "stop" },
      ],
    }),
  );
const toolCall = (name, args) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    }),
  );
async function fixture(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "garden-ai-"));
  const app = createApplication({
    directory,
    inviteCode: "test-invite",
    aiConfig: config,
    aiFetch: async () => answer("测试回答"),
    ...options,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}/api/mobile/v1`;
  async function call(route, data, token) {
    const r = await fetch(base + route, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: r.status, ...(await r.json()) };
  }
  async function register(username = "alice") {
    return (
      await call("/auth/register", {
        username,
        password: "long-password-123",
        inviteCode: "test-invite",
      })
    ).data;
  }
  const conversation = async (token) =>
    (await call("/ai/conversations", { title: "测试会话" }, token)).data;
  const input = (message = "分析我的记录", contextRecordIds = []) => ({
    requestId: randomUUID(),
    message,
    contextRecordIds,
  });
  async function wait(turn, token) {
    for (let i = 0; i < 100; i++) {
      const current = (await call(`/ai/turns/${turn.id}`, undefined, token))
        .data;
      if (current.status !== "running") return current;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("turn timeout");
  }
  return { ...app, call, register, conversation, input, wait };
}
const record = (title = "我的笔记") => ({
  id: randomUUID(),
  kind: "NOTE",
  title,
  body: "私密内容",
  status: "INBOX",
  fields: {},
  tags: [],
  links: [],
  deletedAt: null,
  archivedAt: null,
});
const push = (call, token, r) =>
  call(
    "/sync/push",
    { operations: [{ operationId: randomUUID(), baseVersion: 0, record: r }] },
    token,
  );

test("AI 配置缺失不启用；鉴权和状态不泄露密钥", async (t) => {
  assert.equal(readAiConfig({ AI_ENABLED: "true", AI_MODEL: "x" }), null);
  assert.equal(
    readAiConfig({
      AI_ENABLED: "true",
      AI_PROVIDER: "bad",
      AI_MODEL: "x",
      AI_API_KEY: "key",
    }),
    null,
  );
  assert.equal(
    readAiConfig({
      AI_ENABLED: "true",
      AI_MODEL: "x",
      AI_API_KEY: "key",
      AI_BASE_URL: "https://user:pass@model.test",
    }),
    null,
  );
  assert.equal(
    readAiConfig({
      MOBILE_AI_ENABLED: "true",
      MOBILE_AI_PROVIDER: "ollama",
      MOBILE_AI_MODEL: "x",
    }).baseURL,
    "http://127.0.0.1:11434/v1",
  );
  const f = await fixture(t, { aiConfig: null }),
    a = await f.register();
  assert.equal((await f.call("/ai/status")).status, 401);
  const status = await f.call("/ai/status", undefined, a.accessToken);
  assert.equal(status.data.enabled, false);
  assert.ok(!JSON.stringify(status).includes("secret"));
  const c = await f.conversation(a.accessToken);
  assert.equal(
    (await f.call(`/ai/conversations/${c.id}/turns`, f.input(), a.accessToken))
      .status,
    503,
  );
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM ai_turns").get().n, 0);
});

test("会话、记录上下文和工具读取严格按账号隔离", async (t) => {
  let step = 0,
    seen;
  const secret = record("属于Bob的秘密"),
    mine = record("Alice的笔记");
  const f = await fixture(t, {
    aiFetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.ok(!JSON.stringify(body).includes(secret.title));
      if (step++ === 0) return toolCall("get_record", { id: secret.id });
      seen = JSON.parse(body.messages.at(-1).content);
      return answer("无法读取其他账号的记录");
    },
  });
  const a = await f.register(),
    b = await f.register("bob"),
    c = await f.conversation(a.accessToken);
  await push(f.call, b.accessToken, secret);
  await push(f.call, a.accessToken, mine);
  assert.equal(
    (await f.call(`/ai/conversations/${c.id}`, undefined, b.accessToken))
      .status,
    404,
  );
  assert.equal(
    (
      await f.call(
        `/ai/conversations/${c.id}/turns`,
        f.input("读取", [secret.id]),
        a.accessToken,
      )
    ).status,
    404,
  );
  const r = await f.call(
    `/ai/conversations/${c.id}/turns`,
    f.input("读取", [mine.id]),
    a.accessToken,
  );
  assert.equal((await f.wait(r.data, a.accessToken)).status, "completed");
  assert.ok(seen.error);
  assert.equal(
    (await f.call(`/ai/turns/${r.data.id}`, undefined, b.accessToken)).status,
    404,
  );
  const detail = (
    await f.call(`/ai/conversations/${c.id}`, undefined, a.accessToken)
  ).data;
  assert.equal(detail.messages.length, 2);
  assert.deepEqual(detail.messages[1].sources, [
    { id: mine.id, title: mine.title },
  ]);
  assert.equal(
    (await f.call("/ai/conversations", undefined, b.accessToken)).data
      .conversations.length,
    0,
  );
});

test("请求重试幂等且在途限流；取消后不保存迟到回复", async (t) => {
  let release,
    count = 0;
  const f = await fixture(t, {
    aiFetch: async () => {
      count++;
      await new Promise((r) => {
        release = r;
      });
      return answer("迟到回复");
    },
  });
  const a = await f.register(),
    c = await f.conversation(a.accessToken),
    input = f.input();
  const r = await f.call(
    `/ai/conversations/${c.id}/turns`,
    input,
    a.accessToken,
  );
  assert.equal(r.status, 202);
  assert.equal(
    (await f.call(`/ai/conversations/${c.id}/turns`, input, a.accessToken)).data
      .id,
    r.data.id,
  );
  assert.equal(count, 1);
  assert.equal(
    (
      await f.call(
        `/ai/conversations/${c.id}/turns`,
        { ...input, message: "篡改" },
        a.accessToken,
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.call(`/ai/conversations/${c.id}/turns`, f.input(), a.accessToken))
      .status,
    409,
  );
  assert.equal(
    (await f.call(`/ai/turns/${r.data.id}/cancel`, {}, a.accessToken)).data
      .status,
    "cancelled",
  );
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    f.db
      .prepare("SELECT count(*) AS n FROM ai_messages WHERE role='assistant'")
      .get().n,
    0,
  );
  assert.equal(
    (await f.call(`/ai/conversations/${c.id}/turns`, input, a.accessToken)).data
      .status,
    "cancelled",
  );
});

test("搜索、今日行动、整数分财务工具使用真实记录，查询不会写业务记录", async (t) => {
  let step = 0;
  const outputs = [];
  const f = await fixture(t, {
    clock: () => Date.parse("2026-10-20T16:30:00Z"),
    aiFetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (step) outputs.push(JSON.parse(body.messages.at(-1).content));
      if (step++ === 0) return toolCall("search_records", { q: "学习" });
      if (step === 2) return toolCall("daily_brief", {});
      if (step === 3) return toolCall("finance_summary", {});
      if (step === 4) return toolCall("delete_record", { id: "anything" });
      return answer("已查询，未修改记录");
    },
  });
  const a = await f.register(),
    b = await f.register("bob"),
    c = await f.conversation(a.accessToken);
  await push(f.call, a.accessToken, record("学习计划"));
  await push(f.call, b.accessToken, record("学习秘密"));
  await push(f.call, a.accessToken, {
    ...record("今日行动"),
    kind: "ACTION",
    status: "TODO",
    fields: { dueAt: "2026-10-20T16:01:00Z" },
  });
  await push(f.call, a.accessToken, {
    ...record("收入"),
    kind: "TRANSACTION",
    status: "ACTIVE",
    fields: {
      amountCents: 12345,
      direction: "IN",
      occurredAt: "2026-09-30T16:30:00Z",
    },
  });
  await push(f.call, a.accessToken, {
    ...record("支出"),
    kind: "TRANSACTION",
    status: "ACTIVE",
    fields: {
      amountCents: 101,
      direction: "OUT",
      occurredAt: "2026-10-01T00:00:00Z",
    },
  });
  const before = f.db
    .prepare("SELECT * FROM records ORDER BY user_id,id")
    .all();
  const r = await f.call(
    `/ai/conversations/${c.id}/turns`,
    f.input(),
    a.accessToken,
  );
  assert.equal((await f.wait(r.data, a.accessToken)).status, "completed");
  assert.equal(outputs[0].total, 1);
  assert.equal(outputs[0].records[0].title, "学习计划");
  assert.equal(outputs[1].date, "2026-10-21");
  assert.equal(outputs[1].total, 1);
  assert.equal(outputs[2].incomeCents, 12345);
  assert.equal(outputs[2].expenseCents, 101);
  assert.ok(outputs[3].error);
  assert.deepEqual(
    f.db.prepare("SELECT * FROM records ORDER BY user_id,id").all(),
    before,
  );
});

test("模型失败和超时不回传上游密钥或原始错误；限制工具循环", async (t) => {
  for (const options of [
    {
      aiFetch: async () => new Response("server-only-secret", { status: 401 }),
    },
    { aiFetch: async () => new Response("bad-json") },
    {
      aiFetch: async (_u, init) =>
        new Promise((_r, reject) =>
          init.signal.addEventListener(
            "abort",
            () => reject(init.signal.reason),
            { once: true },
          ),
        ),
      aiTimeoutMs: 10,
    },
    { aiFetch: async () => toolCall("search_records", {}) },
  ]) {
    const f = await fixture(t, options),
      a = await f.register(),
      c = await f.conversation(a.accessToken);
    const r = await f.call(
        `/ai/conversations/${c.id}/turns`,
        f.input(),
        a.accessToken,
      ),
      done = await f.wait(r.data, a.accessToken);
    assert.equal(done.status, "failed");
    assert.ok(done.error);
    assert.ok(!JSON.stringify(done).includes("server-only-secret"));
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS n FROM ai_messages WHERE role='assistant'")
        .get().n,
      0,
    );
  }
});
