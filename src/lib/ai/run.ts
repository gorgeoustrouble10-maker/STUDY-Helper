import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage, type ToolSet } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { AppError } from '../store';
import { definitions, type Kind } from '../types';
import { toolSpecs, executeToolCall, LIMITS, type ToolMode } from './tools';
import { acquireLease, releaseLease, renewLease, verifyLease, expireStaleRuns, recordEvent } from './lease';
import { checkRateLimit } from './rate-limit';
import { readAiConfig, resolveModel, providerOptionsFor } from './providers';
import { readRecord } from './context';
import { describeFieldsForModel } from './fields';

// 工程初始值，可通过真实使用调整。
export const AI_LIMITS = {
    modelSteps: 6,
    toolCalls: LIMITS.toolCalls,
    creates: LIMITS.creates,
    runMs: 120000,
    inputChars: 8000,
    contextChars: 40000,
    contextRecordChars: 4000,
    contextRecordCount: 5,
    bodyChunk: 12000,
    pageSize: 20,
    rateWindowMs: 5 * 60 * 1000,
    rateMax: 20,
    historyMessages: 40,
};

const chatInput = z.object({
    conversationId: z.string().min(1).optional(),
    clientTurnId: z.string().min(8).max(100),
    mode: z.enum(['ANALYSIS', 'WORK']),
    text: z.string().trim().min(1, '请输入内容').max(AI_LIMITS.inputChars),
    contextRecordIds: z.array(z.string().min(1)).max(5).optional(),
});

// 进程内活动运行注册表：同进程内支持取消；跨进程靠租约与数据库状态兜底。
const activeRuns = globalThis as unknown as { __gardenActiveRuns?: Map<string, AbortController> };
const registry = activeRuns.__gardenActiveRuns ?? (activeRuns.__gardenActiveRuns = new Map<string, AbortController>());

function sanitizeError(error: unknown) {
    // 不把供应商原始错误与内部信息透给浏览器。
    return '生成过程中出现问题，本轮已停止。已确认的操作仍然有效，你可以重试。';
}

function buildSystemPrompt(mode: ToolMode, contextBlock: string) {
    const modeText = mode === 'WORK'
        ? '当前为工作模式：新增记录会直接保存（有数量上限），修改/操作/快照类变更仍需所有者确认。'
        : '当前为分析模式：只能读取数据与提出建议。新增类工具不可用；可以创建待确认的修改提议。';
    const fieldDocs = (Object.keys(definitions) as Kind[]).map(kind => `${kind}（${definitions[kind].label}）：${describeFieldsForModel(kind).replace(/\n/g, '；')}`).join('\n');
    return [
        '你是个人数字花园工作台内的 AI 助手，服务唯一的记录所有者。所有数据私密，绝不对外公开。',
        `当前时间：${new Date().toISOString()}（Asia/Shanghai ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}）。`,
        modeText,
        '规则：',
        '- 回答使用简体中文，简洁、可执行。',
        '- 引用记录时只能基于工具真实读取到的内容，并标注记录 ID 与版本号；不确定就说明。',
        '- 修改已有记录一律通过 propose_record_change 创建待确认提议；完成/重开/归档通过 propose_record_operation；复盘快照通过 propose_review_snapshot。',
        '- 金额一律使用整数分（例如 12.50 元 = 1250）。账户不确定时先询问，不要猜测。',
        '- 公开发布、撤回、删除记录、导入恢复、标签合并、修改个人资料不在你的能力范围内；被要求时说明需要所有者亲自操作。',
        '- 不要虚构执行结果；工具返回 error 时向用户如实说明原因。',
        '记录类型与字段（类型：字段（标签，类型））：',
        fieldDocs,
        contextBlock ? `当前上下文记录：\n${contextBlock}` : '',
    ].filter(Boolean).join('\n');
}

async function buildContextBlock(ids: string[]) {
    if (!ids.length)
        return '';
    const blocks: string[] = [];
    let budget = AI_LIMITS.contextRecordChars * AI_LIMITS.contextRecordCount;
    for (const id of ids.slice(0, AI_LIMITS.contextRecordCount)) {
        try {
            const record = await readRecord(id);
            const body = record.body.slice(0, Math.min(AI_LIMITS.contextRecordChars, budget));
            budget -= body.length;
            blocks.push(`[${record.kind}] ${record.title}（id=${record.id} version=${record.version} status=${record.status}）\n${body}${record.hasMoreBody ? '…（正文未完，可用 get_record 继续读取）' : ''}`);
        }
        catch {
            // 上下文记录可能已被删除；忽略。
        }
    }
    return blocks.join('\n---\n');
}

async function loadHistory(conversationId: string) {
    const rows = await db.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' }, take: AI_LIMITS.historyMessages });
    return rows.map(row => ({ id: row.id, role: row.role as 'user' | 'assistant', parts: JSON.parse(row.parts), createdAt: row.createdAt, status: row.status }));
}

// 历史裁剪：按完整消息为单位丢弃最旧的消息，避免产生缺失工具结果的消息序列。
function trimHistory(messages: UIMessage[], budgetChars: number): UIMessage[] {
    const size = (m: UIMessage) => JSON.stringify(m.parts).length;
    const kept: UIMessage[] = [];
    let total = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        const s = size(m);
        if (total + s > budgetChars && kept.length > 0 && m.role === 'assistant')
            break;
        if (total + s > budgetChars && kept.length === 0)
            continue;
        total += s;
        kept.unshift(m);
    }
    return kept;
}

export async function startChatRun(raw: unknown): Promise<Response> {
    const config = readAiConfig();
    if (!config)
        throw new AppError(400, 'AI 助手未启用。请在服务器环境变量中配置 AI_ENABLED 与模型信息。');
    // useChat 的 DefaultChatTransport 信封为 { id, messages, trigger, messageId, ...自定义body }：
    // 用户文本在最后一条 user 消息的 text part 中；mode/clientTurnId 等自定义字段在顶层。
    // 同时兼容直接提交的扁平形状（{ text, mode, clientTurnId, ... }）。
    const envelope = (raw ?? {}) as { messages?: unknown; text?: unknown };
    const messages = Array.isArray(envelope.messages) ? envelope.messages as UIMessage[] : [];
    const lastUser = [...messages].reverse().find(m => m?.role === 'user');
    const extractedText = lastUser
        ? lastUser.parts?.filter((p): p is Extract<NonNullable<typeof lastUser.parts>[number], { type: 'text' }> => p?.type === 'text').map(p => p.text).join('\n') ?? ''
        : '';
    const input = chatInput.parse({ ...envelope, text: extractedText || envelope.text });
    await checkRateLimit('ai-chat:owner', AI_LIMITS.rateMax, AI_LIMITS.rateWindowMs);
    await expireStaleRuns();

    // 会话归属校验
    let conversationId = input.conversationId;
    if (conversationId) {
        const existing = await db.aiConversation.findUnique({ where: { id: conversationId } });
        if (!existing)
            throw new AppError(404, '会话不存在');
    }
    else {
        const created = await db.aiConversation.create({ data: { title: input.text.slice(0, 40) || '新对话' } });
        conversationId = created.id;
    }

    // 幂等：同一轮次重复提交直接返回已有运行
    const duplicate = await db.aiRun.findUnique({ where: { conversationId_clientTurnId: { conversationId, clientTurnId: input.clientTurnId } } });
    if (duplicate)
        throw new AppError(409, '这一轮已经在处理中，请等待完成或刷新查看结果', { runId: duplicate.id, status: duplicate.status });

    // 持久化用户消息（只取文本部分，不信任客户端其他内容）
    const userMessage: UIMessage = { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: input.text }] };
    await db.aiMessage.create({ data: { conversationId, role: 'user', parts: JSON.stringify(userMessage.parts), status: 'COMPLETE' } });

    const leaseToken = randomUUID();
    const run = await db.aiRun.create({ data: {
        conversationId,
        clientTurnId: input.clientTurnId,
        mode: input.mode,
        provider: config.provider,
        model: config.model,
        sessionHash: 'owner',
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 30000),
        input: JSON.stringify({ text: input.text, contextRecordIds: input.contextRecordIds ?? [] }),
        assistantMessageId: randomUUID(),
    } });
    await acquireLease(run.id, leaseToken);
    await recordEvent(run.id, 'run.started', { mode: input.mode, model: config.model });

    const history = await loadHistory(conversationId);
    const historyMessages = trimHistory(history.map(m => ({ id: m.id, role: m.role, parts: m.parts } as UIMessage)), AI_LIMITS.contextChars - AI_LIMITS.contextRecordChars * AI_LIMITS.contextRecordCount);
    const contextBlock = await buildContextBlock(input.contextRecordIds ?? []);

    const toolContext: Omit<import('./tools').ToolContext, 'toolCallId'> = { runId: run.id, mode: input.mode, leaseToken, usage: { toolCalls: 0, creates: 0 } };
    const tools: ToolSet = Object.fromEntries(toolSpecs.map(spec => [spec.name, tool({
        description: spec.description,
        inputSchema: spec.parameters,
        async execute(args: unknown, options: { toolCallId: string }) {
            const result = await executeToolCall({ ...toolContext, toolCallId: options.toolCallId }, spec.name, args, options.toolCallId);
            return result;
        },
    })]));

    const controller = new AbortController();
    registry.set(run.id, controller);
    const abortSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(AI_LIMITS.runMs)]);

    // 租约续期：后台定时器，丢失时立即中止生成。
    const renewTimer = setInterval(async () => {
        if (!(await renewLease(run.id, leaseToken)))
            controller.abort();
    }, 10000);

    const result = streamText({
        model: resolveModel(config),
        system: buildSystemPrompt(input.mode, contextBlock),
        messages: await convertToModelMessages(historyMessages),
        tools,
        stopWhen: stepCountIs(AI_LIMITS.modelSteps),
        abortSignal,
        providerOptions: providerOptionsFor(config),
    });

    // 流错误兜底：text Promise 拒绝意味着本轮生成失败（解析错误/连接中断）。
    // 终态守卫（status: RUNNING）保证与 onEnd、cancelRun 之间只有第一个收敛生效。
    let streamFailed = false;
    void Promise.resolve(result.text).then(() => {}, async () => {
        streamFailed = true;
        recordEvent(run.id, 'run.failed', {}).catch(() => {});
        await finish('FAILED', 'STREAM_ERROR');
    });

    const finish = async (status: 'COMPLETE' | 'CANCELLED' | 'FAILED', errorCode?: string) => {
        clearInterval(renewTimer);
        registry.delete(run.id);
        try {
            const usage = await Promise.resolve(result.usage).then(u => u, () => null);
            await db.aiRun.updateMany({ where: { id: run.id, leaseToken, status: 'RUNNING' }, data: {
                status,
                activeOwnerKey: null,
                finishedAt: new Date(),
                usage: usage ? JSON.stringify({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens }) : undefined,
                toolCount: toolContext.usage.toolCalls,
                createCount: toolContext.usage.creates,
                errorCode,
            } });
        }
        catch {
            // 收尾失败不影响响应
        }
    };

    return result.toUIMessageStreamResponse({
        originalMessages: historyMessages,
        onError: sanitizeError,
        headers: { 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
        onEnd: async ({ messages }) => {
            const last = messages.at(-1);
            try {
                if (last && last.role === 'assistant' && !streamFailed)
                    await db.aiMessage.create({ data: { conversationId, role: 'assistant', parts: JSON.stringify(last.parts), status: controller.signal.aborted ? 'CANCELLED' : 'COMPLETE' } });
                await recordEvent(run.id, 'run.finished', { cancelled: controller.signal.aborted, failed: streamFailed });
                await finish(streamFailed ? 'FAILED' : controller.signal.aborted ? 'CANCELLED' : 'COMPLETE', streamFailed ? 'STREAM_ERROR' : undefined);
            }
            catch {
                await finish('FAILED', 'PERSIST_FAILED');
            }
        },
    });
}

// 明确取消：尽力中断生成；已提交的写入保留。
export async function cancelRun(runId: string) {
    registry.get(runId)?.abort();
    const run = await db.aiRun.findUnique({ where: { id: runId } });
    if (!run)
        throw new AppError(404, '运行不存在');
    if (run.status === 'RUNNING')
        await db.aiRun.updateMany({ where: { id: runId, status: 'RUNNING' }, data: { status: 'CANCELLED', activeOwnerKey: null, finishedAt: new Date(), errorCode: 'CANCELLED_BY_OWNER' } });
    return { id: runId, status: (await db.aiRun.findUniqueOrThrow({ where: { id: runId } })).status };
}

export async function getRunState(runId: string) {
    const run = await db.aiRun.findUnique({ where: { id: runId }, include: { operations: { orderBy: { createdAt: 'asc' } }, events: { orderBy: { id: 'asc' } } } });
    if (!run)
        throw new AppError(404, '运行不存在');
    return { id: run.id, conversationId: run.conversationId, mode: run.mode, status: run.status, provider: run.provider, model: run.model, toolCount: run.toolCount, createCount: run.createCount, usage: run.usage ? JSON.parse(run.usage) : null, errorCode: run.errorCode, createdAt: run.createdAt, finishedAt: run.finishedAt, operations: run.operations.map(o => ({ id: o.id, type: o.type, status: o.status, recordId: o.recordId, expectedVersion: o.expectedVersion, payload: JSON.parse(o.payload), result: o.result ? JSON.parse(o.result) : null, hash: o.hash, expiresAt: o.expiresAt })), events: run.events.map(e => ({ id: e.id, type: e.type, data: JSON.parse(e.data), createdAt: e.createdAt })) };
}

export async function verifyRunWritable(runId: string, leaseToken: string) {
    return verifyLease(runId, leaseToken);
}
