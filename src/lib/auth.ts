import { db } from './db';
import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { AppError } from './store';
const derive = promisify(scrypt);
export const cookieName = 'garden_session';
export async function hashPassword(password: string) { if (password.length < 10 || password.length > 200)
    throw new AppError(400, '密码长度应为10至200个字符'); const salt = randomBytes(16).toString('hex'); const hash = await derive(password, salt, 64) as Buffer; return `scrypt:${salt}:${hash.toString('hex')}`; }
export async function verifyPassword(password: string, stored: string) { const [, salt, expected] = stored.split(':'); if (!salt || !expected)
    return false; const value = await derive(password, salt, 64) as Buffer; const buffer = Buffer.from(expected, 'hex'); return value.length === buffer.length && timingSafeEqual(value, buffer); }
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function currentOwner() { const token = (await cookies()).get(cookieName)?.value; if (!token)
    return null; const session = await db.session.findUnique({ where: { tokenHash: tokenHash(token) } }); if (!session || session.expiresAt < new Date())
    return null; return db.owner.findUnique({ where: { id: 'owner' }, select: { username: true } }); }
export async function requireOwner() { const owner = await currentOwner(); if (!owner)
    throw new AppError(401, '请先登录工作台'); return owner; }
export function checkOrigin(request: Request) {
    const origin = request.headers.get('origin');
    const target = new URL(request.url);
    const allowed = new Set([target.origin, process.env.SITE_URL].filter(Boolean));
    if (!origin || !allowed.has(origin))
        throw new AppError(403, '请求来源不正确，请从本站页面操作');
}
export async function login(username: string, password: string, address: string) {
    if (password.length > 200 || username.length > 100)
        throw new AppError(400, '登录信息格式不正确');
    const key = tokenHash('owner-login');
    const now = new Date();
    // 计数与窗口判断在同一事务内完成，避免并发请求各自读到旧计数而绕过限速。
    const attempt = await db.$transaction(async (tx) => {
        const existing = await tx.loginAttempt.findUnique({ where: { key } });
        const withinWindow = existing && now.getTime() - existing.windowAt.getTime() < 900000;
        return withinWindow
            ? await tx.loginAttempt.update({ where: { key }, data: { count: { increment: 1 } } })
            : await tx.loginAttempt.upsert({ where: { key }, create: { key, count: 1, windowAt: now }, update: { count: 1, windowAt: now } });
    });
    if (attempt.count > 8)
        throw new AppError(429, '尝试次数过多，请15分钟后重试');
    const owner = await db.owner.findUnique({ where: { id: 'owner' } });
    if (!owner)
        throw new AppError(400, '尚未创建所有者账号，请运行 npm run owner:init');
    const verified = await verifyPassword(password, owner.passwordHash);
    if (owner.username !== username || !verified)
        throw new AppError(401, '账号或密码不正确');
    await db.loginAttempt.delete({ where: { key } });
    const token = randomBytes(32).toString('hex');
    const days = Math.min(30, Math.max(1, Number(process.env.SESSION_DAYS) || 7));
    const expiresAt = new Date(Date.now() + days * 86400000);
    await db.session.create({ data: { tokenHash: tokenHash(token), expiresAt } });
    return { token, expiresAt };
}
