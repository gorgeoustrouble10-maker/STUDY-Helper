import { db } from '../db';
import { definitions, type Kind } from '../types';
import { AppError, getRecord, getProfile } from '../store';

// 读取工具的数据实现。原则：列表查询不加载全部正文、统计由服务器计算、分页与截断明确标记。

export type RecordSummary = {
    id: string;
    kind: Kind;
    title: string;
    status: string;
    version: number;
    updatedAt: string;
    snippet: string;
    bodyLength: number;
    truncated: boolean;
};

export type SearchParams = { q?: string; kinds?: string[]; status?: string; tag?: string; page?: number; size?: number };

export async function searchRecords(params: SearchParams) {
    const page = Math.max(1, params.page ?? 1);
    const size = Math.min(50, Math.max(1, params.size ?? 20));
    const conditions: string[] = ['r."deletedAt" IS NULL', 'r."archivedAt" IS NULL'];
    const values: unknown[] = [];
    if (params.q?.trim()) {
        const like = `%${params.q.trim()}%`;
        conditions.push('(r."title" LIKE ? OR r."body" LIKE ? OR EXISTS (SELECT 1 FROM "RecordTag" rt JOIN "Tag" t ON t."id" = rt."tagId" WHERE rt."recordId" = r."id" AND (t."name" LIKE ? OR t."aliases" LIKE ?)))');
        values.push(like, like, like, like);
    }
    const kinds = params.kinds?.filter((k): k is Kind => k in definitions);
    if (kinds?.length) {
        conditions.push(`r."kind" IN (${kinds.map(() => '?').join(',')})`);
        values.push(...kinds);
    }
    if (params.status) {
        conditions.push('r."status" = ?');
        values.push(params.status);
    }
    if (params.tag?.trim()) {
        conditions.push('EXISTS (SELECT 1 FROM "RecordTag" rt2 JOIN "Tag" t2 ON t2."id" = rt2."tagId" WHERE rt2."recordId" = r."id" AND t2."name" = ?)');
        values.push(params.tag.trim());
    }
    const whereSql = conditions.map(c => `(${c})`).join(' AND ');
    const rows = await db.$queryRawUnsafe<any[]>(`SELECT r."id", r."kind", r."title", r."status", r."version", r."updatedAt", substr(r."body", 1, 201) AS snippet, length(r."body") AS bodyLength FROM "Record" r WHERE ${whereSql} ORDER BY r."updatedAt" DESC LIMIT ? OFFSET ?`, ...values, size, (page - 1) * size);
    const totals = await db.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS total FROM "Record" r WHERE ${whereSql}`, ...values);
    const total = Number(totals[0]?.total ?? 0);
    const list: RecordSummary[] = rows.map(r => ({
        id: r.id, kind: r.kind, title: r.title, status: r.status, version: r.version, updatedAt: new Date(r.updatedAt).toISOString(),
        snippet: String(r.snippet ?? ''), bodyLength: Number(r.bodyLength ?? 0), truncated: Number(r.bodyLength ?? 0) > 200,
    }));
    return { list, total, page, size, hasMore: page * size < total };
}

// 正文分块读取上限（字符）。
export const BODY_CHUNK_SIZE = 12000;

export async function readRecord(id: string, bodyOffset = 0) {
    const record = await getRecord(id);
    if (record.deletedAt)
        throw new AppError(400, '记录在回收站中，需要先恢复');
    const start = Math.max(0, Math.min(bodyOffset, record.body.length));
    const bodyChunk = record.body.slice(start, start + BODY_CHUNK_SIZE);
    const hasMoreBody = start + BODY_CHUNK_SIZE < record.body.length;
    // 复盘快照只返回摘要，需要时另行读取。
    const fields = { ...record.fields };
    if (record.kind === 'REVIEW' && typeof fields.snapshots === 'string') {
        try {
            const snapshots = JSON.parse(String(fields.snapshots)) as any[];
            fields.snapshots = JSON.stringify({ snapshotsCount: snapshots.length, summaries: snapshots.slice(0, 20).map(s => ({ id: s.id, title: s.title, bodySnippet: String(s.body ?? '').slice(0, 120) })) });
        }
        catch {
            delete fields.snapshots;
        }
    }
    return { ...record, fields, body: bodyChunk, bodyRange: { offset: start, returned: bodyChunk.length, total: record.body.length }, hasMoreBody, nextBodyOffset: hasMoreBody ? start + BODY_CHUNK_SIZE : null };
}

const shanghaiDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

// 今日与本周概况：全部由服务器按真实记录计算。
export async function dailyBrief() {
    const today = shanghaiDate(new Date());
    const dayStart = new Date(`${today}T00:00:00+08:00`);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const weekStart = new Date(dayStart.getTime() - 6 * 86400000);
    const actions = await db.action.findMany({ where: { record: { deletedAt: null, archivedAt: null } }, include: { record: true } });
    const brief = (a: (typeof actions)[number]) => ({ id: a.recordId, title: a.record.title, status: a.record.status, plannedAt: a.plannedAt?.toISOString() ?? null, dueAt: a.dueAt?.toISOString() ?? null, todayFocus: a.todayFocus, priority: a.priority });
    const now = new Date();
    const transactions = await db.transaction.findMany({ where: { record: { deletedAt: null }, occurredAt: { gte: dayStart, lt: dayEnd } } });
    return {
        date: today,
        todayFocus: actions.filter(a => a.todayFocus).map(brief),
        dueToday: actions.filter(a => a.dueAt && a.dueAt >= dayStart && a.dueAt < dayEnd && a.record.status !== 'DONE').map(brief),
        overdue: actions.filter(a => a.dueAt && a.dueAt < now && a.record.status !== 'DONE').map(brief),
        plannedToday: actions.filter(a => a.plannedAt && a.plannedAt >= dayStart && a.plannedAt < dayEnd).map(brief),
        blockedOrWaiting: actions.filter(a => ['BLOCKED', 'WAITING'].includes(a.record.status)).map(brief),
        thisWeekPlanned: actions.filter(a => a.plannedAt && a.plannedAt >= weekStart && a.plannedAt < dayEnd).length,
        todayTransactions: { income: transactions.filter(t => t.direction === 'IN').reduce((n, t) => n + t.amountCents, 0), expense: transactions.filter(t => t.direction === 'OUT').reduce((n, t) => n + t.amountCents, 0), count: transactions.length },
    };
}

// 财务汇总（整数分）。工作台路由复用同一实现，保证口径一致。
export async function financeSummary() {
    const transactions = await db.transaction.findMany({ where: { record: { deletedAt: null } } });
    const accounts = await db.account.findMany({ where: { record: { deletedAt: null } }, include: { record: true } });
    const budgets = await db.budget.findMany({ where: { record: { deletedAt: null } }, include: { record: true } });
    const month = shanghaiDate(new Date()).slice(0, 7);
    const monthly = transactions.filter(t => shanghaiDate(t.occurredAt).slice(0, 7) === month);
    return {
        month,
        income: monthly.filter(t => t.direction === 'IN').reduce((n, t) => n + t.amountCents, 0),
        expense: monthly.filter(t => t.direction === 'OUT').reduce((n, t) => n + t.amountCents, 0),
        accounts: accounts.map(a => ({ id: a.recordId, title: a.record.title, balance: a.openingCents + transactions.filter(t => t.accountId === a.recordId).reduce((n, t) => n + t.amountCents * (t.direction === 'IN' ? 1 : -1), 0) })),
        budgets: budgets.map(b => ({ id: b.recordId, title: b.record.title, period: b.period, category: b.category, limit: b.limitCents, spent: transactions.filter(t => t.direction === 'OUT' && t.category === b.category && shanghaiDate(t.occurredAt).slice(0, 7) === b.period).reduce((n, t) => n + t.amountCents, 0) })),
    };
}

export async function listTagsWithCount() {
    const rows = await db.$queryRawUnsafe<any[]>(`SELECT t."id", t."name", t."aliases", COUNT(rt."recordId") AS count FROM "Tag" t LEFT JOIN "RecordTag" rt ON rt."tagId" = t."id" GROUP BY t."id" ORDER BY t."name" ASC`);
    return rows.map(r => ({ id: r.id, name: r.name, aliases: r.aliases, count: Number(r.count) }));
}
