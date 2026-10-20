import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { tokenHash } from './auth';
import { AppError, createRecord, getRecord, recordOperation, updateRecord } from './store';
import type { GardenRecord } from './types';

export const mobileStatuses = ['TODO', 'DOING', 'WAITING', 'BLOCKED', 'DONE'] as const;
const taskInput = z.object({
  title: z.string().trim().min(1, '请填写任务标题').max(200),
  priority: z.number().int().min(1).max(3),
  estimatedMinutes: z.number().int().positive().max(2147483647),
});
const version = z.number().int().positive();
const pairKey = tokenHash('mobile-pair-attempts');

export function checkMobileTransport(request: Request) {
  const url = new URL(request.url);
  const host = (request.headers.get('host') || url.host).split(':')[0];
  const privateHost = host === 'localhost' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  // HTTP is an explicit development exception, never a production fallback.
  const localDev = process.env.NODE_ENV !== 'production' && process.env.MOBILE_ALLOW_LAN_HTTP === 'true' && privateHost;
  if (url.protocol !== 'https:' && !process.env.SITE_URL?.startsWith('https://') && !localDev)
    throw new AppError(403, '手机连接需要 HTTPS；本地开发请使用 dev:lan');
  if (request.headers.has('origin'))
    throw new AppError(403, '此接口仅供手机应用连接，请在博客工作台管理配对');
}

export async function issuePairing() {
  const code = String(randomInt(10000000, 100000000));
  const expiresAt = new Date(Date.now() + 5 * 60000);
  await db.$transaction(async tx => {
    await tx.mobilePairing.deleteMany({});
    await tx.mobilePairing.create({ data: { codeHash: tokenHash(code), expiresAt } });
    // Issuing a fresh code from an authenticated browser also unlocks pairing.
    await tx.loginAttempt.deleteMany({ where: { key: pairKey } });
  });
  return { code, expiresAt };
}

export async function redeemPairing(raw: unknown) {
  const input = z.object({ code: z.string().regex(/^\d{8}$/), label: z.string().trim().min(1).max(60) }).strict().parse(raw);
  const now = new Date();
  const attempt = await db.$transaction(async tx => {
    const old = await tx.loginAttempt.findUnique({ where: { key: pairKey } });
    return old && now.getTime() - old.windowAt.getTime() < 900000
      ? tx.loginAttempt.update({ where: { key: pairKey }, data: { count: { increment: 1 } } })
      : tx.loginAttempt.upsert({ where: { key: pairKey }, create: { key: pairKey, count: 1, windowAt: now }, update: { count: 1, windowAt: now } });
  });
  if (attempt.count > 8) throw new AppError(429, '配对尝试过多，请在电脑重新生成配对码');
  const token = randomBytes(32).toString('hex');
  return db.$transaction(async tx => {
    const used = await tx.mobilePairing.deleteMany({ where: { codeHash: tokenHash(input.code), expiresAt: { gt: now } } });
    if (!used.count) throw new AppError(401, '配对码无效、已使用或已过期');
    const owner = await tx.owner.findUnique({ where: { id: 'owner' }, select: { username: true } });
    if (!owner) throw new AppError(400, '请先初始化博客所有者');
    const session = await tx.mobileSession.create({ data: { id: randomUUID(), tokenHash: tokenHash(token), label: input.label, expiresAt: new Date(Date.now() + 7 * 86400000) } });
    return { token, sessionId: session.id, username: owner.username, expiresAt: session.expiresAt };
  });
}

export async function requireMobile(request: Request) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') || '');
  if (!match) throw new AppError(401, '请先连接博客');
  const session = await db.mobileSession.findUnique({ where: { tokenHash: tokenHash(match[1]) } });
  if (!session || session.expiresAt <= new Date()) throw new AppError(401, '手机连接已失效，请重新配对');
  return session;
}

export function mobileTask(row: GardenRecord) {
  return { id: row.id, title: row.title, status: row.status, version: row.version,
    priority: Number(row.fields.priority), estimatedMinutes: row.fields.estimatedMinutes ?? null,
    updatedAt: row.updatedAt };
}

export async function mobileSnapshot() {
  return db.$transaction(async tx => {
    const rows = await tx.record.findMany({ where: { kind: 'ACTION', deletedAt: null, archivedAt: null }, include: { action: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
    const tasks = rows.map(row => ({ id: row.id, title: row.title, status: row.status, version: row.version,
      priority: row.action?.priority ?? 2, estimatedMinutes: row.action?.estimatedMinutes ?? null, updatedAt: row.updatedAt.toISOString() }));
    return { tasks, stats: { completedCount: tasks.filter(t => t.status === 'DONE').length,
      totalMinutes: tasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0),
      unestimatedCount: tasks.filter(t => t.estimatedMinutes === null).length }, fetchedAt: new Date().toISOString() };
  });
}

async function activeAction(id: string, tx: any) {
  const row = await getRecord(id, tx);
  if (row.kind !== 'ACTION' || row.deletedAt || row.archivedAt) throw new AppError(404, '任务不存在或已归档');
  return row;
}

export async function createMobileTask(sessionId: string, raw: unknown) {
  const input = taskInput.extend({ clientMutationId: z.string().uuid() }).strict().parse(raw);
  const { clientMutationId, ...fields } = input;
  const id = `${sessionId}:${clientMutationId}`, requestHash = tokenHash(JSON.stringify(fields));
  const run = () => db.$transaction(async tx => {
    const old = await tx.mobileMutation.findUnique({ where: { id } });
    if (old) {
      if (old.requestHash !== requestHash) throw new AppError(409, '这次新增已提交，请刷新后重新新增');
      return mobileTask(await activeAction(old.recordId, tx));
    }
    const task = await createRecord({ kind: 'ACTION', title: input.title, fields: { priority: input.priority, estimatedMinutes: input.estimatedMinutes } }, tx);
    await tx.mobileMutation.create({ data: { id, sessionId, requestHash, recordId: task.id } });
    return mobileTask(task);
  });
  try { return await run(); }
  catch (error) {
    if ((error as { code?: string }).code === 'P2002') return run();
    throw error;
  }
}

export async function updateMobileTask(id: string, raw: unknown) {
  const input = taskInput.partial().extend({ version, status: z.enum(mobileStatuses).optional() }).strict().parse(raw);
  if (Object.keys(input).length === 1) throw new AppError(400, '请选择要修改的内容');
  return db.$transaction(async tx => {
    const old = await activeAction(id, tx);
    const fields = { ...old.fields };
    for (const key of ['priority', 'estimatedMinutes'] as const) if (input[key] !== undefined) fields[key] = input[key];
    // Reuse the blog's revision, repeat and conflict semantics, retaining all other fields.
    const updated = await updateRecord(id, { kind: 'ACTION', title: input.title ?? old.title, status: input.status ?? old.status,
      body: old.body, fields, tags: old.tags, links: old.links.map(l => ({ toId: l.toId, relation: l.relation })), version: input.version }, tx);
    return mobileTask(updated);
  });
}

export async function deleteMobileTask(id: string, raw: unknown) {
  const input = z.object({ version }).strict().parse(raw);
  await db.$transaction(async tx => { await activeAction(id, tx); await recordOperation(id, 'delete', input.version, tx); });
  return { deleted: true };
}
