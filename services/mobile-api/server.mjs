import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAiService, AiError } from "./ai.mjs";

const derive = promisify(scrypt);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const kinds = new Set([
  "NOTE",
  "ACTION",
  "COURSE",
  "PROJECT",
  "DOMAIN",
  "ISSUE",
  "RESOURCE",
  "REVIEW",
  "PERSON",
  "ITEM",
  "ACCOUNT",
  "TRANSACTION",
  "BUDGET",
  "CHANNEL",
  "PUBLICATION",
]);
const statuses = {
  NOTE: ["INBOX", "ACTIVE", "DONE"],
  ACTION: ["TODO", "DOING", "WAITING", "BLOCKED", "DONE"],
  COURSE: ["ACTIVE", "DONE"],
  PROJECT: ["ACTIVE", "WAITING", "DONE"],
  DOMAIN: ["ACTIVE"],
  ISSUE: [
    "CLARIFY",
    "READY",
    "TRYING",
    "OBSERVING",
    "RELIEVED",
    "RESOLVED",
    "DEFERRED",
    "ACCEPTED",
  ],
  RESOURCE: ["ACTIVE", "READING", "DONE"],
  REVIEW: ["ACTIVE", "DONE"],
  PERSON: ["ACTIVE"],
  ITEM: ["ACTIVE"],
  ACCOUNT: ["ACTIVE"],
  TRANSACTION: ["ACTIVE"],
  BUDGET: ["ACTIVE"],
  CHANNEL: ["DRAFT", "PUBLISHED"],
  PUBLICATION: ["DRAFT"],
};
const idPattern = /^[a-zA-Z0-9-]{8,80}$/;
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max) => typeof value === "string" && value.length <= max;

export function createApplication({
  directory,
  inviteCode = process.env.REGISTRATION_INVITE_CODE || "",
  clock = Date.now,
  aiConfig,
  aiFetch,
  aiTimeoutMs,
} = {}) {
  directory ||= process.env.MOBILE_DATA_DIR || ".data/mobile-api";
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, "mobile.db"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), access_hash TEXT UNIQUE NOT NULL, refresh_hash TEXT UNIQUE NOT NULL, access_until INTEGER NOT NULL, refresh_until INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records(user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, doc TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(user_id,id));
    CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, id TEXT NOT NULL, doc TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS changes_user_seq ON changes(user_id,seq);
    CREATE TABLE IF NOT EXISTS operations(user_id TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(user_id,id));
    CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS revisions(user_id TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL, doc TEXT NOT NULL, PRIMARY KEY(user_id,record_id,version));
  `);
  const ai = createAiService({
    db,
    clock,
    config: aiConfig,
    fetchImpl: aiFetch,
    timeoutMs: aiTimeoutMs,
  });
  const tx = (work) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const userInfo = (row) => ({ id: row.id, username: row.username });
  function rate(key, limit) {
    const now = clock();
    const row = db.prepare("SELECT * FROM attempts WHERE key=?").get(key);
    const active = row && now - row.window_at < 900000;
    const count = active ? row.count + 1 : 1;
    db.prepare(
      "INSERT INTO attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,window_at=excluded.window_at",
    ).run(key, count, active ? row.window_at : now);
    if (count > limit) fail(429, "RATE_LIMIT", "尝试次数过多，请15分钟后重试");
    if (Math.random() < 0.01)
      db.prepare("DELETE FROM attempts WHERE window_at<?").run(now - 900000);
  }
  function tokens(user, oldId, createUser = false) {
    const accessToken = randomBytes(32).toString("hex"),
      refreshToken = randomBytes(32).toString("hex");
    const accessExpiresAt = clock() + 3600000;
    tx(() => {
      if (createUser)
        db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
          user.id,
          user.username,
          user.password,
          clock(),
        );
      if (oldId) db.prepare("DELETE FROM sessions WHERE id=?").run(oldId);
      db.prepare("DELETE FROM sessions WHERE refresh_until<?").run(clock());
      db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
        randomUUID(),
        user.id,
        sha(accessToken),
        sha(refreshToken),
        accessExpiresAt,
        clock() + 30 * 86400000,
      );
    });
    return { user: userInfo(user), accessToken, refreshToken, accessExpiresAt };
  }
  function authenticated(request) {
    const value = request.headers.authorization || "";
    if (!/^Bearer [a-f0-9]{64}$/.test(value))
      fail(401, "UNAUTHENTICATED", "请先登录");
    const session = db
      .prepare("SELECT * FROM sessions WHERE access_hash=? AND access_until>?")
      .get(sha(value.slice(7)), clock());
    if (!session) fail(401, "SESSION_EXPIRED", "登录已过期，请重新登录");
    return session;
  }
  async function bodyOf(request) {
    if (
      !String(request.headers["content-type"] || "").startsWith(
        "application/json",
      )
    )
      fail(415, "CONTENT_TYPE", "请求格式不正确");
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 512 * 1024) fail(413, "TOO_LARGE", "内容超过大小限制");
      chunks.push(chunk);
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      fail(400, "INVALID_JSON", "请求内容不正确");
    }
    if (!object(data)) fail(400, "INVALID_JSON", "请求内容不正确");
    return data;
  }
  function normalizeRecord(raw, previous, userId) {
    if (
      !object(raw) ||
      !idPattern.test(raw.id || "") ||
      !kinds.has(raw.kind) ||
      !text(raw.title, 300) ||
      !raw.title.trim() ||
      !text(raw.body, 100000)
    )
      fail(400, "INVALID_RECORD", "请检查记录标题和正文");
    if (previous && raw.kind !== previous.kind)
      fail(400, "INVALID_KIND", "不能改变记录类型");
    if (
      !statuses[raw.kind].includes(raw.status) ||
      !object(raw.fields) ||
      JSON.stringify(raw.fields).length > 100000
    )
      fail(400, "INVALID_FIELDS", "记录字段或状态不正确");
    if (
      !Array.isArray(raw.tags) ||
      raw.tags.length > 30 ||
      raw.tags.some((v) => !text(v, 60))
    )
      fail(400, "INVALID_TAGS", "标签不正确");
    if (!Array.isArray(raw.links) || raw.links.length > 100)
      fail(400, "INVALID_LINKS", "关联记录不正确");
    const links = raw.links.map((link) => {
      if (
        !object(link) ||
        !idPattern.test(link.toId || "") ||
        !text(link.relation, 30)
      )
        fail(400, "INVALID_LINKS", "关联记录不正确");
      if (
        link.toId !== raw.id &&
        !db
          .prepare("SELECT 1 FROM records WHERE user_id=? AND id=?")
          .get(userId, link.toId)
      )
        fail(400, "INVALID_LINKS", "关联对象不存在或不可访问");
      return { toId: link.toId, relation: link.relation };
    });
    if (
      raw.kind === "TRANSACTION" &&
      (!Number.isSafeInteger(raw.fields.amountCents) ||
        raw.fields.amountCents <= 0)
    )
      fail(400, "INVALID_MONEY", "金额必须是大于零的整数分");
    for (const [key, kind] of [
      ["accountId", "ACCOUNT"],
      ["parentId", "ACTION"],
    ])
      if (raw.fields[key]) {
        if (typeof raw.fields[key] !== "string")
          fail(400, "INVALID_REFERENCE", "关联对象不正确");
        const target = db
          .prepare("SELECT doc FROM records WHERE user_id=? AND id=?")
          .get(userId, raw.fields[key]);
        if (
          !target ||
          JSON.parse(target.doc).kind !== kind ||
          JSON.parse(target.doc).deletedAt
        )
          fail(400, "INVALID_REFERENCE", "关联对象不存在或不可访问");
      }
    if (raw.kind === "ACTION" && raw.fields.parentId) {
      const visited = new Set([raw.id]);
      let parent = raw.fields.parentId;
      while (parent) {
        if (visited.has(parent))
          fail(400, "PARENT_CYCLE", "父行动不能形成循环");
        visited.add(parent);
        const p = db
          .prepare("SELECT doc FROM records WHERE user_id=? AND id=?")
          .get(userId, parent);
        parent = p ? JSON.parse(p.doc).fields.parentId : null;
      }
    }
    const now = new Date(clock()).toISOString();
    return {
      id: raw.id,
      kind: raw.kind,
      title: raw.title.trim(),
      body: raw.body,
      status: raw.status,
      fields: raw.fields,
      tags: [...new Set(raw.tags)],
      links,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      archivedAt: raw.archivedAt ? now : null,
      deletedAt: raw.deletedAt ? now : null,
      version: (previous?.version || 0) + 1,
    };
  }
  function operation(userId, op) {
    if (
      !object(op) ||
      !idPattern.test(op.operationId || "") ||
      !Number.isSafeInteger(op.baseVersion) ||
      op.baseVersion < 0
    )
      fail(400, "INVALID_OPERATION", "同步操作格式不正确");
    const digest = sha(JSON.stringify(op));
    return tx(() => {
      const saved = db
        .prepare("SELECT * FROM operations WHERE user_id=? AND id=?")
        .get(userId, op.operationId);
      if (saved) {
        if (saved.digest !== digest)
          fail(409, "OPERATION_REUSED", "同步操作标识已被其他内容使用");
        return JSON.parse(saved.result);
      }
      const current = db
        .prepare("SELECT doc FROM records WHERE user_id=? AND id=?")
        .get(userId, op.record?.id || "");
      const previous = current ? JSON.parse(current.doc) : null;
      let result;
      if (op.baseVersion !== (previous?.version || 0)) {
        result = {
          operationId: op.operationId,
          status: "conflict",
          remote: previous,
        };
      } else {
        const doc = normalizeRecord(op.record, previous, userId);
        if (previous)
          db.prepare("INSERT INTO revisions VALUES(?,?,?,?)").run(
            userId,
            doc.id,
            previous.version,
            JSON.stringify(previous),
          );
        db.prepare(
          "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET doc=excluded.doc,version=excluded.version",
        ).run(userId, doc.id, JSON.stringify(doc), doc.version);
        db.prepare("INSERT INTO changes(user_id,id,doc) VALUES(?,?,?)").run(
          userId,
          doc.id,
          JSON.stringify(doc),
        );
        if (
          doc.kind === "ACTION" &&
          doc.status === "DONE" &&
          previous?.status !== "DONE" &&
          ["DAILY", "WEEKLY", "MONTHLY"].includes(doc.fields.repeat)
        ) {
          const hash = sha(`repeat:${doc.id}`);
          const nextId = [
            hash.slice(0, 8),
            hash.slice(8, 12),
            hash.slice(12, 16),
            hash.slice(16, 20),
            hash.slice(20, 32),
          ].join("-");
          if (
            !db
              .prepare("SELECT 1 FROM records WHERE user_id=? AND id=?")
              .get(userId, nextId)
          ) {
            const fields = {
              ...doc.fields,
              todayFocus: false,
              previousId: doc.id,
            };
            for (const key of ["plannedAt", "dueAt", "remindAt"])
              if (fields[key]) {
                const date = new Date(
                  new Date(fields[key]).getTime() + 8 * 3600000,
                );
                if (Number.isNaN(date.getTime())) continue;
                if (fields.repeat === "MONTHLY") {
                  const anchorKey = `repeatAnchor_${key}`;
                  const day = Number(fields[anchorKey] || date.getUTCDate());
                  fields[anchorKey] = day;
                  date.setUTCDate(1);
                  date.setUTCMonth(date.getUTCMonth() + 1);
                  date.setUTCDate(
                    Math.min(
                      day,
                      new Date(
                        Date.UTC(
                          date.getUTCFullYear(),
                          date.getUTCMonth() + 1,
                          0,
                        ),
                      ).getUTCDate(),
                    ),
                  );
                } else
                  date.setUTCDate(
                    date.getUTCDate() + (fields.repeat === "WEEKLY" ? 7 : 1),
                  );
                fields[key] = new Date(
                  date.getTime() - 8 * 3600000,
                ).toISOString();
              }
            const next = {
              ...doc,
              id: nextId,
              status: "TODO",
              fields,
              version: 1,
              createdAt: doc.updatedAt,
            };
            db.prepare("INSERT INTO records VALUES(?,?,?,1)").run(
              userId,
              nextId,
              JSON.stringify(next),
            );
            db.prepare("INSERT INTO changes(user_id,id,doc) VALUES(?,?,?)").run(
              userId,
              nextId,
              JSON.stringify(next),
            );
          }
        }
        result = { operationId: op.operationId, status: "ok", record: doc };
      }
      db.prepare("INSERT INTO operations VALUES(?,?,?,?)").run(
        userId,
        op.operationId,
        digest,
        JSON.stringify(result),
      );
      return result;
    });
  }
  const server = http.createServer(async (request, response) => {
    const send = (status, data) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify(data));
    };
    try {
      const url = new URL(request.url, "http://localhost");
      const route = url.pathname.replace(/^\/api\/mobile\/v1/, "");
      const method = request.method;
      if (method === "GET" && route === "/health")
        return send(200, {
          data: { status: "ok", version: "0.2.0", registration: !!inviteCode },
        });
      const ip =
        request.socket.remoteAddress?.replace("::ffff:", "") || "unknown";
      const trustedIp =
        (ip === "127.0.0.1" || ip === "::1") &&
        typeof request.headers["x-real-ip"] === "string"
          ? request.headers["x-real-ip"]
          : ip;
      if (
        method === "POST" &&
        (route === "/auth/register" || route === "/auth/login")
      ) {
        rate(`${route}:${trustedIp}`, route.endsWith("register") ? 15 : 40);
        const data = await bodyOf(request);
        if (route.endsWith("register")) {
          if (!inviteCode) fail(503, "REGISTRATION_CLOSED", "注册暂未开放");
          if (typeof data.inviteCode !== "string" || !data.inviteCode)
            fail(403, "INVITE_REQUIRED", "请输入邀请码");
          if (
            !timingSafeEqual(
              Buffer.from(sha(data.inviteCode)),
              Buffer.from(sha(inviteCode)),
            )
          )
            fail(403, "INVALID_INVITE", "邀请码不正确");
        }
        if (
          !text(data.username, 40) ||
          !/^[\p{L}\p{N}_-]{3,40}$/u.test(data.username) ||
          !text(data.password, 200) ||
          data.password.length < 10
        )
          fail(
            400,
            "INVALID_CREDENTIALS",
            "账号需3–40位字母、数字或下划线，密码需10–200位",
          );
        const username = data.username.normalize("NFKC").toLowerCase();
        let user = db
          .prepare("SELECT * FROM users WHERE username=?")
          .get(username);
        if (route.endsWith("register")) {
          if (user) fail(409, "USERNAME_TAKEN", "账号已被使用");
          const salt = randomBytes(16).toString("hex");
          const hash = await derive(data.password, salt, 64);
          user = {
            id: randomUUID(),
            username,
            password: `${salt}:${hash.toString("hex")}`,
          };
          let result;
          try {
            result = tokens(user, undefined, true);
          } catch (e) {
            if (String(e.code).includes("CONSTRAINT"))
              fail(409, "USERNAME_TAKEN", "账号已被使用");
            throw e;
          }
          return send(201, { data: result });
        }
        rate(`login-user:${username}`, 15);
        const [salt, expected] = (
          user?.password || `${"0".repeat(32)}:${"0".repeat(128)}`
        ).split(":");
        const hash = await derive(data.password, salt, 64);
        if (!user || !timingSafeEqual(hash, Buffer.from(expected, "hex")))
          fail(401, "INVALID_CREDENTIALS", "账号或密码不正确");
        db.prepare("DELETE FROM attempts WHERE key=?").run(
          `login-user:${username}`,
        );
        return send(200, { data: tokens(user) });
      }
      if (method === "POST" && route === "/auth/refresh") {
        rate(`refresh:${trustedIp}`, 100);
        const data = await bodyOf(request);
        if (!text(data.refreshToken, 100))
          fail(401, "SESSION_EXPIRED", "请重新登录");
        const old = db
          .prepare(
            "SELECT * FROM sessions WHERE refresh_hash=? AND refresh_until>?",
          )
          .get(sha(data.refreshToken), clock());
        if (!old) fail(401, "SESSION_EXPIRED", "请重新登录");
        return send(200, {
          data: tokens(
            db.prepare("SELECT * FROM users WHERE id=?").get(old.user_id),
            old.id,
          ),
        });
      }
      const session = authenticated(request),
        userId = session.user_id;
      if (route.startsWith("/ai/")) {
        await ai.handle({
          method,
          route,
          userId,
          data: method === "POST" ? await bodyOf(request) : undefined,
          send,
        });
        return;
      }
      if (method === "GET" && route === "/me")
        return send(200, {
          data: userInfo(
            db.prepare("SELECT * FROM users WHERE id=?").get(userId),
          ),
        });
      if (method === "POST" && route === "/auth/logout") {
        db.prepare("DELETE FROM sessions WHERE id=?").run(session.id);
        return send(200, { data: { signedOut: true } });
      }
      if (method === "GET" && route === "/sync/pull") {
        const cursor = Number(url.searchParams.get("cursor") || 0);
        if (!Number.isSafeInteger(cursor) || cursor < 0)
          fail(400, "INVALID_CURSOR", "同步位置不正确");
        const rows = db
          .prepare(
            "SELECT seq,doc FROM changes WHERE user_id=? AND seq>? ORDER BY seq LIMIT 101",
          )
          .all(userId, cursor);
        const page = rows.slice(0, 100);
        return send(200, {
          data: {
            changes: page.map((row) => ({
              cursor: row.seq,
              record: JSON.parse(row.doc),
            })),
            cursor: page.at(-1)?.seq || cursor,
            hasMore: rows.length > 100,
          },
        });
      }
      if (method === "POST" && route === "/sync/push") {
        rate(`sync:${userId}`, 600);
        const data = await bodyOf(request);
        if (!Array.isArray(data.operations) || data.operations.length > 30)
          fail(400, "INVALID_BATCH", "每批最多30个操作");
        const results = data.operations.map((op) => {
          try {
            return operation(userId, op);
          } catch (e) {
            if (e instanceof ApiError)
              return {
                operationId: op?.operationId,
                status: "error",
                code: e.code,
                message: e.message,
              };
            throw e;
          }
        });
        return send(200, { data: { results } });
      }
      fail(404, "NOT_FOUND", "接口不存在");
    } catch (e) {
      if (!(e instanceof ApiError) && !(e instanceof AiError))
        console.error("mobile-api error:", e.code || e.name);
      if (!response.headersSent)
        send(e.status || 500, {
          error: {
            code: e.code || "INTERNAL",
            message: e.status ? e.message : "暂时无法完成操作，请稍后重试",
          },
        });
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  return {
    server,
    db,
    close: async () => {
      await ai.close();
      return new Promise((resolve) =>
        server.close(() => {
          db.close();
          resolve();
        }),
      );
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createApplication();
  app.server.listen(Number(process.env.PORT || 13301), "127.0.0.1", () =>
    console.log("mobile-api listening on loopback"),
  );
  process.on("SIGTERM", () => {
    app.close().then(() => process.exit(0));
  });
}
