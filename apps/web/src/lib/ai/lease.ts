import { db } from '../db';
import { AppError } from '../store';

// 运行租约：每位所有者同时只允许一个生成中的运行。
// activeOwnerKey 唯一约束由数据库保证；租约 30 秒过期、每 10 秒续期。
export const LEASE_TTL_MS = 30000;
export const LEASE_RENEW_MS = 10000;
export const OWNER_KEY = 'owner';

// 将过期仍在 RUNNING 的运行标记为中断（进程意外结束后恢复用），不自动重放写入。
export async function expireStaleRuns() {
    const now = new Date();
    await db.aiRun.updateMany({ where: { status: 'RUNNING', leaseExpiresAt: { lt: now } }, data: { status: 'INTERRUPTED', activeOwnerKey: null, finishedAt: now, errorCode: 'RUN_INTERRUPTED' } });
}

export async function acquireLease(runId: string, leaseToken: string) {
    await expireStaleRuns();
    const now = new Date();
    try {
        await db.aiRun.update({ where: { id: runId }, data: { activeOwnerKey: OWNER_KEY, leaseToken, leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS) } });
    }
    catch {
        throw new AppError(409, '已有正在进行的生成，请等待其完成或先取消');
    }
}

// 续租与身份校验一体：租约丢失（被中断/接管）返回 false，调用方应立即停止后续写入。
export async function renewLease(runId: string, leaseToken: string) {
    const changed = await db.aiRun.updateMany({ where: { id: runId, leaseToken, status: 'RUNNING' }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS) } });
    return changed.count > 0;
}

// 每次业务提交前检查租约身份与运行状态。
export async function verifyLease(runId: string, leaseToken: string) {
    const run = await db.aiRun.findUnique({ where: { id: runId } });
    return Boolean(run && run.status === 'RUNNING' && run.leaseToken === leaseToken && run.leaseExpiresAt > new Date());
}

export async function releaseLease(runId: string, leaseToken: string, status: 'COMPLETE' | 'CANCELLED' | 'FAILED' | 'INTERRUPTED', errorCode?: string) {
    await db.aiRun.updateMany({ where: { id: runId, leaseToken }, data: { status, activeOwnerKey: null, finishedAt: new Date(), errorCode } });
}

// 有序运行事件：供跨设备恢复与调试。
export async function recordEvent(runId: string, type: string, data: unknown, client: { aiRunEvent: { create: Function } } = db) {
    await client.aiRunEvent.create({ data: { runId, type, data: JSON.stringify(data ?? {}) } });
}
