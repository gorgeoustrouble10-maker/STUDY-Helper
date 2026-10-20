import { db } from '../db';
import { AppError } from '../store';

// 与登录限速相同的模式：计数与窗口判断在同一事务内，防止并发请求各自读到旧计数。
export async function checkRateLimit(key: string, limit: number, windowMs: number) {
    const now = new Date();
    const row = await db.$transaction(async (tx) => {
        const existing = await tx.aiRateLimit.findUnique({ where: { key } });
        const withinWindow = existing && now.getTime() - existing.windowAt.getTime() < windowMs;
        return withinWindow
            ? await tx.aiRateLimit.update({ where: { key }, data: { count: { increment: 1 } } })
            : await tx.aiRateLimit.upsert({ where: { key }, create: { key, count: 1, windowAt: now }, update: { count: 1, windowAt: now } });
    });
    if (row.count > limit)
        throw new AppError(429, `请求过于频繁，请${Math.ceil(windowMs / 60000)}分钟后再试`);
}
