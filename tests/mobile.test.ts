import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
const testDir = path.resolve('.test-data', `mobile-${randomUUID()}`);
process.env.DATA_DIR = testDir;
process.env.DATABASE_URL = `file:${path.join(testDir, 'garden.db').replaceAll('\\', '/')}`;
let mobile: typeof import('../src/lib/mobile'), store: typeof import('../src/lib/store'), db: typeof import('../src/lib/db')['db'];
let token = '', sessionId = '';
before(async () => {
  await mkdir(testDir, { recursive: true });
  new Database(path.join(testDir, 'garden.db')).close();
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe', windowsHide: true });
  mobile = await import('../src/lib/mobile'); store = await import('../src/lib/store'); db = (await import('../src/lib/db')).db;
  await db.owner.create({ data: { id: 'owner', username: 'mobile-test', passwordHash: 'unused' } });
});
after(async () => { await db?.$disconnect(); });
const request = (value = token) => new Request('https://garden.example/api/mobile/tasks', { headers: { Authorization: `Bearer ${value}` } });
const editable = (r: any) => ({ ...r, links: r.links.map((l: any) => ({ toId: l.toId, relation: l.relation })) });

test('一次性配对、令牌哈希、过期和网页 Cookie 隔离', async () => {
  await assert.rejects(() => mobile.requireMobile(new Request('https://garden.example/api/mobile/tasks', { headers: { cookie: 'garden_session=ignored' } })), (e: any) => e.status === 401);
  const pair = await mobile.issuePairing();
  const connected = await mobile.redeemPairing({ code: pair.code, label: 'Mate60 Pro' });
  token = connected.token; sessionId = connected.sessionId;
  assert.equal(connected.username, 'mobile-test');
  assert.notEqual((await db.mobileSession.findUniqueOrThrow({ where: { id: sessionId } })).tokenHash, token);
  assert.equal((await mobile.requireMobile(request())).id, sessionId);
  await assert.rejects(() => mobile.redeemPairing({ code: pair.code, label: '第二台' }), (e: any) => e.status === 401);
  const expired = await mobile.issuePairing();
  await db.mobilePairing.updateMany({ data: { expiresAt: new Date(0) } });
  await assert.rejects(() => mobile.redeemPairing({ code: expired.code, label: '过期' }), (e: any) => e.status === 401);
});

test('局域网明文必须显式开启，生产禁用；网页请求不能使用原生入口', () => {
  const local = new Request('http://192.168.31.93:3000/api/mobile/tasks');
  const saved = { node: process.env.NODE_ENV, allow: process.env.MOBILE_ALLOW_LAN_HTTP, site: process.env.SITE_URL };
  try {
    Object.assign(process.env, { NODE_ENV: 'development' }); delete process.env.SITE_URL; delete process.env.MOBILE_ALLOW_LAN_HTTP;
    assert.throws(() => mobile.checkMobileTransport(local), (e: any) => e.status === 403);
    process.env.MOBILE_ALLOW_LAN_HTTP = 'true'; mobile.checkMobileTransport(local);
    assert.throws(() => mobile.checkMobileTransport(new Request('http://public.example/api/mobile/tasks')), (e: any) => e.status === 403);
    Object.assign(process.env, { NODE_ENV: 'production' }); assert.throws(() => mobile.checkMobileTransport(local), (e: any) => e.status === 403);
    assert.throws(() => mobile.checkMobileTransport(new Request('https://garden.example/api/mobile/tasks', { headers: { origin: 'https://evil.example' } })), (e: any) => e.status === 403);
  } finally { for (const [key, value] of Object.entries({ NODE_ENV: saved.node, MOBILE_ALLOW_LAN_HTTP: saved.allow, SITE_URL: saved.site })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('配对错误八次限速，只有工作台生成新码才能立即解锁', async () => {
  const pair = await mobile.issuePairing();
  for (let i = 0; i < 8; i++) await assert.rejects(() => mobile.redeemPairing({ code: '00000000', label: '错误' }), (e: any) => e.status === 401);
  await assert.rejects(() => mobile.redeemPairing({ code: pair.code, label: '限速' }), (e: any) => e.status === 429);
  const next = await mobile.issuePairing();
  assert.ok((await mobile.redeemPairing({ code: next.code, label: '新码' })).token);
});

test('手机新增幂等，参数变化拒绝重复使用标识，合法估时校验', async () => {
  const input = { title: '手机新增', priority: 1, estimatedMinutes: 30, clientMutationId: randomUUID() };
  const first = await mobile.createMobileTask(sessionId, input), second = await mobile.createMobileTask(sessionId, input);
  assert.equal(first.id, second.id);
  assert.equal(await db.record.count({ where: { title: input.title } }), 1);
  await assert.rejects(() => mobile.createMobileTask(sessionId, { ...input, title: '不同内容' }), (e: any) => e.status === 409);
  for (const invalid of [0, -1, 1.5, 2147483648]) await assert.rejects(() => mobile.createMobileTask(sessionId, { ...input, clientMutationId: randomUUID(), estimatedMinutes: invalid }));
  await assert.rejects(() => mobile.createMobileTask(sessionId, { ...input, clientMutationId: randomUUID(), body: '不允许修改正文' }));
});

test('复用 ACTION，保留正文关联等待状态；并发拒绝旧版本', async () => {
  const project = await store.createRecord({ kind: 'PROJECT', title: '已有项目' });
  const original = await store.createRecord({ kind: 'ACTION', title: '等待资料', body: '私密正文', status: 'WAITING', fields: { priority: 3, blocker: '等老师', repeat: 'NONE' }, tags: ['原标签'], links: [{ toId: project.id, relation: 'related' }] });
  const changed = await mobile.updateMobileTask(original.id, { version: original.version, title: '等待老师资料', estimatedMinutes: 45 });
  assert.equal(changed.status, 'WAITING');
  const record = await store.getRecord(original.id);
  assert.equal(record.body, original.body); assert.equal(record.fields.blocker, '等老师');
  assert.deepEqual(record.tags, ['原标签']); assert.equal(record.links[0].toId, project.id);
  await assert.rejects(() => mobile.updateMobileTask(original.id, { version: original.version, status: 'DONE' }), (e: any) => e.status === 409);
  assert.equal((await store.getRecord(original.id)).status, 'WAITING');
  const done = await mobile.updateMobileTask(record.id, { version: changed.version, status: 'DONE' });
  assert.ok((await store.getRecord(record.id)).fields.completedAt);
  await mobile.updateMobileTask(record.id, { version: done.version, status: 'BLOCKED' });
  assert.equal((await store.getRecord(record.id)).fields.completedAt, null);
  await assert.rejects(() => mobile.updateMobileTask(project.id, { version: project.version, title: '越权' }), (e: any) => e.status === 404);
});

test('全量快照统计保留未估时，归档删除不返回，删除进入同一回收站', async () => {
  const old = await store.createRecord({ kind: 'ACTION', title: '未估时历史任务' });
  const trash = await store.createRecord({ kind: 'ACTION', title: '需要删除', fields: { estimatedMinutes: 20 } });
  await assert.rejects(() => mobile.deleteMobileTask(trash.id, { version: 999 }), (e: any) => e.status === 409);
  await mobile.deleteMobileTask(trash.id, { version: trash.version });
  assert.ok((await store.getRecord(trash.id)).deletedAt);
  await store.recordOperation(old.id, 'archive', old.version);
  const snapshot = await mobile.mobileSnapshot();
  assert.ok(!snapshot.tasks.some(t => [old.id, trash.id].includes(t.id)));
  assert.equal(snapshot.stats.totalMinutes, snapshot.tasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0));
  assert.equal(snapshot.stats.unestimatedCount, snapshot.tasks.filter(t => t.estimatedMinutes === null).length);
  assert.ok(!JSON.stringify(snapshot).includes('私密正文'));
});

test('撤销与到期立即阻止令牌，移动令牌不能成为网页会话', async () => {
  await db.mobileSession.update({ where: { id: sessionId }, data: { expiresAt: new Date(0) } });
  await assert.rejects(() => mobile.requireMobile(request()), (e: any) => e.status === 401);
  await db.mobileSession.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() + 60000) } });
  await db.mobileSession.delete({ where: { id: sessionId } });
  await assert.rejects(() => mobile.requireMobile(request()), (e: any) => e.status === 401);
  const { tokenHash } = await import('../src/lib/auth');
  assert.equal(await db.session.findUnique({ where: { tokenHash: tokenHash(token) } }), null);
});
