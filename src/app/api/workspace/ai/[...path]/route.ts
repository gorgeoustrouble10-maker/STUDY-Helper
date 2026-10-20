import { requireOwner, checkOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { ok, failure } from '@/lib/http';
import { AppError } from '@/lib/store';
import { z } from 'zod';
import { readAiConfig } from '@/lib/ai/providers';
import { AI_LIMITS, startChatRun, cancelRun, getRunState } from '@/lib/ai/run';
import { decideOperation, undoCreate, expireStaleProposals } from '@/lib/ai/operations';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };

const noStore = (data: unknown, status = 200) => {
    const response = ok(data, status) as Response;
    response.headers.set('Cache-Control', 'no-store');
    return response;
};

export async function GET(request: Request, context: Context) {
    try {
        await requireOwner();
        const parts = (await context.params).path;
        const config = readAiConfig();
        if (parts[0] === 'status')
            return noStore({ enabled: Boolean(config), provider: config?.provider ?? null, model: config?.model ?? null, limits: AI_LIMITS });
        if (!config && parts[0] !== 'status')
            return noStore({ enabled: false, note: 'AI 助手未启用' });
        if (parts[0] === 'conversations' && !parts[1]) {
            const list = await db.aiConversation.findMany({ orderBy: { updatedAt: 'desc' }, take: 50, include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } } });
            return noStore({ list: list.map(c => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, lastMessage: c.messages[0] ? { role: c.messages[0].role, preview: JSON.stringify(JSON.parse(c.messages[0].parts)).slice(0, 120) } : null })) });
        }
        if (parts[0] === 'conversations' && parts[1] === 'operations') {
            // 全部待处理提议（跨会话），供确认中心使用
            await expireStaleProposals();
            const rows = await db.aiOperation.findMany({ where: { status: { in: ['PROPOSED', 'CONFLICTED'] } }, orderBy: { createdAt: 'desc' }, take: 50, include: { run: { select: { conversationId: true, mode: true, model: true } } } });
            return noStore({ list: rows.map(o => ({ id: o.id, runId: o.runId, conversationId: o.run.conversationId, type: o.type, status: o.status, recordId: o.recordId, expectedVersion: o.expectedVersion, payload: JSON.parse(o.payload), before: JSON.parse(o.before || '{}'), result: o.result ? JSON.parse(o.result) : null, hash: o.hash, expiresAt: o.expiresAt, createdAt: o.createdAt })) });
        }
        if (parts[0] === 'conversations' && parts[1]) {
            const conversation = await db.aiConversation.findUnique({ where: { id: parts[1] } });
            if (!conversation)
                throw new AppError(404, '会话不存在');
            const [messages, runs] = await Promise.all([
                db.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } }),
                db.aiRun.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: 10, include: { operations: { orderBy: { createdAt: 'asc' } } } }),
            ]);
            return noStore({
                id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
                messages: messages.map(m => ({ id: m.id, role: m.role, parts: JSON.parse(m.parts), status: m.status, createdAt: m.createdAt })),
                runs: runs.map(r => ({ id: r.id, status: r.status, mode: r.mode, errorCode: r.errorCode, createdAt: r.createdAt, finishedAt: r.finishedAt })),
                operations: runs.flatMap(r => r.operations).map(o => ({ id: o.id, runId: o.runId, type: o.type, status: o.status, recordId: o.recordId, expectedVersion: o.expectedVersion, payload: JSON.parse(o.payload), before: JSON.parse(o.before || '{}'), result: o.result ? JSON.parse(o.result) : null, hash: o.hash, expiresAt: o.expiresAt, createdAt: o.createdAt })),
            });
        }
        if (parts[0] === 'runs' && parts[1])
            return noStore(await getRunState(parts[1]));
        throw new AppError(404, '接口不存在');
    }
    catch (e) {
        return failure(e);
    }
}

export async function POST(request: Request, context: Context) {
    try {
        await requireOwner();
        checkOrigin(request);
        const parts = (await context.params).path;
        if (parts[0] === 'chat')
            return await startChatRun(await request.json());
        if (Number(request.headers.get('content-length')) > 256 * 1024)
            throw new AppError(413, '内容过大');
        const body = await request.json().catch(() => ({}));
        if (parts[0] === 'conversations' && !parts[1]) {
            const title = z.object({ title: z.string().trim().max(80).optional() }).parse(body).title;
            const created = await db.aiConversation.create({ data: title ? { title } : {} });
            return noStore({ id: created.id, title: created.title }, 201);
        }
        if (parts[0] === 'runs' && parts[1] && parts[2] === 'cancel')
            return noStore(await cancelRun(parts[1]));
        if (parts[0] === 'operations' && parts[1] && parts[2] === 'decision') {
            const input = z.object({ decision: z.enum(['confirm', 'reject']), expectedHash: z.string().length(64) }).parse(body);
            return noStore(await decideOperation(parts[1], input.decision, input.expectedHash));
        }
        if (parts[0] === 'operations' && parts[1] && parts[2] === 'undo-create')
            return noStore(await undoCreate(parts[1]));
        throw new AppError(404, '接口不存在');
    }
    catch (e) {
        return failure(e);
    }
}

export async function DELETE(request: Request, context: Context) {
    try {
        await requireOwner();
        checkOrigin(request);
        const parts = (await context.params).path;
        if (parts[0] === 'conversations' && parts[1]) {
            const conversation = await db.aiConversation.findUnique({ where: { id: parts[1] } });
            if (!conversation)
                throw new AppError(404, '会话不存在');
            // 取消进行中的运行，再清除对话数据（级联删除消息、运行、操作与事件）。已创建的业务记录不受影响。
            await db.aiRun.updateMany({ where: { conversationId: conversation.id, status: 'RUNNING' }, data: { status: 'CANCELLED', activeOwnerKey: null, finishedAt: new Date() } });
            await db.aiConversation.delete({ where: { id: conversation.id } });
            return noStore({ deleted: true });
        }
        throw new AppError(404, '接口不存在');
    }
    catch (e) {
        return failure(e);
    }
}
