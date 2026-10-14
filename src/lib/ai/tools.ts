import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { definitions, type Kind } from '../types';
import { AppError, createRecord, getRecord, getProfile } from '../store';
import { aiWritableFields, buildFullUpdate, recordPatch } from './fields';
import { searchRecords, readRecord, dailyBrief, financeSummary, listTagsWithCount } from './context';
import { createProposal, createAppliedOperation, findExistingOperation } from './operations';
import { verifyLease, recordEvent } from './lease';

// 单轮限制。
export const LIMITS = { toolCalls: 20, creates: 10 };

export type ToolMode = 'ANALYSIS' | 'WORK';
export type ToolContext = { runId: string; toolCallId: string; mode: ToolMode; leaseToken: string; usage: { toolCalls: number; creates: number } };
export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string; message: string };

export type ToolSpec = {
    name: string;
    description: string;
    parameters: z.ZodTypeAny;
    // 仅工作模式可用（自动落库类）。提议类工具两种模式都可用，因为它们不修改记录。
    workOnly?: boolean;
    execute: (ctx: ToolContext, args: any) => Promise<unknown>;
};

const kindSchema = z.enum(Object.keys(definitions) as [Kind, ...Kind[]]);

function requireWork(ctx: ToolContext) {
    if (ctx.mode !== 'WORK')
        throw new AppError(403, '分析模式只读取和提出建议。请由所有者在界面切换到工作模式后再执行新增。');
}

async function withLeaseCheck(ctx: ToolContext) {
    // 提交业务变更前再次校验运行身份：取消或租约丢失后不再执行写入。
    if (!(await verifyLease(ctx.runId, ctx.leaseToken)))
        throw new AppError(409, '本轮运行已停止，操作未执行');
}

const searchRecordsTool: ToolSpec = {
    name: 'search_records',
    description: '按关键词、类型、状态或标签搜索记录。返回摘要（标题、状态、版本、正文前200字符），不返回全文。',
    parameters: z.object({ q: z.string().max(200).optional(), kinds: z.array(kindSchema).max(10).optional(), status: z.string().max(30).optional(), tag: z.string().max(60).optional(), page: z.number().int().positive().optional() }),
    async execute(_ctx, args) {
        return searchRecords(args);
    },
};

const getRecordTool: ToolSpec = {
    name: 'get_record',
    description: '读取一条记录的完整字段与正文分块（每块最多12000字符）。正文更长时用 bodyOffset 继续读取。',
    parameters: z.object({ recordId: z.string().min(1), bodyOffset: z.number().int().min(0).optional() }),
    async execute(_ctx, args) {
        return readRecord(args.recordId, args.bodyOffset ?? 0);
    },
};

const dailyBriefTool: ToolSpec = {
    name: 'daily_brief',
    description: '今日与本周概况：今日重点、到期、逾期、受阻行动与今日收支（服务器计算）。',
    parameters: z.object({}),
    async execute() {
        return dailyBrief();
    },
};

const financeSummaryTool: ToolSpec = {
    name: 'finance_summary',
    description: '本月收支汇总、账户余额与预算消耗（整数分，服务器计算）。',
    parameters: z.object({}),
    async execute() {
        return financeSummary();
    },
};

const listTagsTool: ToolSpec = {
    name: 'list_tags',
    description: '列出全部标签与使用次数。',
    parameters: z.object({}),
    async execute() {
        return listTagsWithCount();
    },
};

const getProfileTool: ToolSpec = {
    name: 'get_profile',
    description: '读取公开个人资料（只读）。',
    parameters: z.object({}),
    async execute() {
        return getProfile();
    },
};

const baseCreateShape = {
    title: z.string().trim().min(1, '请填写标题').max(200),
    body: z.string().max(500000).optional(),
    status: z.string().optional(),
    fields: z.record(z.string(), z.unknown()).default({}),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
    links: z.array(z.object({ toId: z.string().min(1), relation: z.enum(['related', 'source', 'action', 'evidence', 'chapter', 'assignment']).default('related') })).max(100).default([]),
};

function assertWritableFields(kind: Kind, fields: Record<string, unknown>) {
    const writable = new Set(aiWritableFields(kind));
    for (const key of Object.keys(fields))
        if (!writable.has(key))
            throw new AppError(400, `字段 ${key} 不允许 AI 设置`);
}

// 自动新增（工作模式）：业务写入与 APPLIED 凭证同事务；重复 toolCallId 只返回已有凭证。
async function applyCreate(ctx: ToolContext, kind: Kind, args: any, type: 'create_record' | 'draft_publication') {
    const existing = await findExistingOperation(ctx.runId, ctx.toolCallId);
    if (existing)
        return { operationId: existing.id, applied: true, replayed: true, ...JSON.parse(existing.result || '{}') };
    await withLeaseCheck(ctx);
    const payload = { kind, title: args.title, body: args.body ?? '', status: args.status, fields: args.fields ?? {}, tags: args.tags ?? [], links: args.links ?? [] };
    const created = await db.$transaction(async (tx) => {
        const record = await createRecord(payload, tx);
        const op = await createAppliedOperation(tx, { runId: ctx.runId, toolCallId: ctx.toolCallId, type, payload }, { recordId: record.id, version: record.version }, record.id);
        return { record, operationId: op.id };
    });
    ctx.usage.creates++;
    await recordEvent(ctx.runId, 'operation.applied', { type, operationId: created.operationId, recordId: created.record.id });
    return { operationId: created.operationId, applied: true, recordId: created.record.id, version: created.record.version, title: created.record.title };
}

const createRecordTool: ToolSpec = {
    name: 'create_record',
    description: '新增一条内部记录（仅工作模式直接保存）。字段见各类型的可写字段说明。',
    parameters: z.object({ kind: kindSchema, ...baseCreateShape }),
    workOnly: true,
    async execute(ctx, args) {
        if (ctx.usage.creates >= LIMITS.creates)
            throw new AppError(429, `本轮自动新增已达上限（${LIMITS.creates} 条）`);
        assertWritableFields(args.kind, args.fields ?? {});
        return applyCreate(ctx, args.kind, args, 'create_record');
    },
};

const draftPublicationTool: ToolSpec = {
    name: 'draft_publication',
    description: '从素材建立一篇独立的公开稿草稿（仅工作模式直接保存为草稿，绝不发布）。来源记录通过 links 关联。',
    parameters: z.object({ ...baseCreateShape, publicationType: z.enum(['article', 'work', 'garden', 'recommendation']).default('article'), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/).optional() }),
    workOnly: true,
    async execute(ctx, args) {
        if (ctx.usage.creates >= LIMITS.creates)
            throw new AppError(429, `本轮自动新增已达上限（${LIMITS.creates} 条）`);
        const fields: Record<string, unknown> = { ...(args.fields ?? {}) };
        fields.publicationType = args.publicationType;
        if (args.slug)
            fields.slug = args.slug;
        assertWritableFields('PUBLICATION', fields);
        return applyCreate(ctx, 'PUBLICATION', { ...args, fields }, 'draft_publication');
    },
};

// 提议类工具：两种模式都可用；不修改任何记录，只创建待确认凭证。
const proposeChangeTool: ToolSpec = {
    name: 'propose_record_change',
    description: '提议修改一条已有记录的部分内容。未提到的字段保持原值；null 表示清空（仅日期/文本类字段）。需要所有者确认差异后才会执行。',
    parameters: recordPatch,
    async execute(ctx, args) {
        const existing = await findExistingOperation(ctx.runId, ctx.toolCallId);
        if (existing)
            return { operationId: existing.id, replayed: true, status: existing.status };
        const current = await getRecord(args.recordId);
        if (current.deletedAt)
            throw new AppError(400, '记录在回收站中，需要先恢复');
        const full = buildFullUpdate(current.kind, current, args);
        await withLeaseCheck(ctx);
        const proposal = await createProposal({ runId: ctx.runId, toolCallId: ctx.toolCallId, type: 'propose_change', recordId: args.recordId, expectedVersion: args.expectedVersion, payload: args, before: current });
        await recordEvent(ctx.runId, 'operation.proposed', { operationId: proposal.id, type: 'propose_change', recordId: args.recordId });
        const changes: string[] = [];
        if (args.title !== undefined) changes.push('标题');
        if (args.body !== undefined) changes.push('正文');
        if (args.status !== undefined) changes.push(`状态→${args.status}`);
        if (args.tags !== undefined) changes.push('标签');
        if (args.links !== undefined) changes.push('关联');
        for (const key of Object.keys(args.fields ?? {})) changes.push(`字段 ${key}`);
        return { operationId: proposal.id, proposed: true, recordId: args.recordId, expectedVersion: args.expectedVersion, changes, previewKind: current.kind, hash: proposal.hash, note: '已创建修改提议，等待所有者确认' };
    },
};

const proposeOperationTool: ToolSpec = {
    name: 'propose_record_operation',
    description: '提议对已有记录执行完成/重新打开/归档/取消归档。需要所有者确认后执行。',
    parameters: z.object({ recordId: z.string().min(1), expectedVersion: z.number().int().positive(), operation: z.enum(['complete', 'reopen', 'archive', 'unarchive']) }),
    async execute(ctx, args) {
        const existing = await findExistingOperation(ctx.runId, ctx.toolCallId);
        if (existing)
            return { operationId: existing.id, replayed: true, status: existing.status };
        const current = await getRecord(args.recordId);
        if (current.deletedAt)
            throw new AppError(400, '记录在回收站中，需要先恢复');
        if (args.operation === 'complete' && !definitions[current.kind].statuses.includes('DONE'))
            throw new AppError(400, '此记录类型不能标记完成');
        await withLeaseCheck(ctx);
        const proposal = await createProposal({ runId: ctx.runId, toolCallId: ctx.toolCallId, type: 'propose_operation', recordId: args.recordId, expectedVersion: args.expectedVersion, payload: { operation: args.operation }, before: current });
        await recordEvent(ctx.runId, 'operation.proposed', { operationId: proposal.id, type: 'propose_operation', recordId: args.recordId });
        return { operationId: proposal.id, proposed: true, operation: args.operation, recordId: args.recordId, hash: proposal.hash, note: args.operation === 'complete' && current.kind === 'ACTION' && current.fields.repeat && current.fields.repeat !== 'NONE' ? '注意：完成重复行动会自动生成下一次实例' : '已创建操作提议，等待所有者确认' };
    },
};

const proposeSnapshotTool: ToolSpec = {
    name: 'propose_review_snapshot',
    description: '提议为复盘记录生成快照，快照内容为该复盘当前关联的全部证据记录。需要所有者确认后执行。',
    parameters: z.object({ recordId: z.string().min(1), expectedVersion: z.number().int().positive() }),
    async execute(ctx, args) {
        const existing = await findExistingOperation(ctx.runId, ctx.toolCallId);
        if (existing)
            return { operationId: existing.id, replayed: true, status: existing.status };
        const current = await getRecord(args.recordId);
        if (current.kind !== 'REVIEW' || current.deletedAt)
            throw new AppError(400, '仅有效复盘支持快照');
        await withLeaseCheck(ctx);
        const proposal = await createProposal({ runId: ctx.runId, toolCallId: ctx.toolCallId, type: 'propose_snapshot', recordId: args.recordId, expectedVersion: args.expectedVersion, payload: {}, before: current });
        await recordEvent(ctx.runId, 'operation.proposed', { operationId: proposal.id, type: 'propose_snapshot', recordId: args.recordId });
        return { operationId: proposal.id, proposed: true, recordId: args.recordId, evidenceCount: current.links.length, evidenceIds: current.links.map(l => l.toId), hash: proposal.hash, note: '快照将引用以上证据记录的当前内容' };
    },
};

export const toolSpecs: ToolSpec[] = [
    searchRecordsTool, getRecordTool, dailyBriefTool, financeSummaryTool, listTagsTool, getProfileTool,
    createRecordTool, draftPublicationTool, proposeChangeTool, proposeOperationTool, proposeSnapshotTool,
];

// 统一执行入口：计数限制、参数校验、模式矩阵与业务错误都在这里收敛。
// toolCallId 是本次工具调用的稳定标识（模型返回的调用 ID）；未提供时自动生成。
export async function executeToolCall(ctx: ToolContext, name: string, rawArgs: unknown, toolCallId: string = randomUUID()): Promise<ToolResult> {
    const callCtx: ToolContext = { ...ctx, toolCallId };
    const spec = toolSpecs.find(t => t.name === name);
    if (!spec)
        return { ok: false, error: 'UNKNOWN_TOOL', message: `未知工具 ${name}` };
    if (callCtx.usage.toolCalls >= LIMITS.toolCalls)
        return { ok: false, error: 'LIMIT_REACHED', message: `本轮工具调用已达上限（${LIMITS.toolCalls} 次）` };
    callCtx.usage.toolCalls++;
    const parsed = spec.parameters.safeParse(rawArgs ?? {});
    if (!parsed.success)
        return { ok: false, error: 'INVALID_ARGUMENTS', message: parsed.error.issues.map(i => `${i.path.join('.') || '参数'}: ${i.message}`).join('; ') };
    if (spec.workOnly && callCtx.mode !== 'WORK')
        return { ok: false, error: 'ANALYSIS_MODE_READONLY', message: '分析模式只能读取与提出建议。请在界面切换到工作模式后再执行该操作；当前可以用 propose_ 系列工具创建待确认提议。' };
    try {
        return { ok: true, data: await spec.execute(callCtx, parsed.data) };
    }
    catch (e) {
        if (e instanceof AppError)
            return { ok: false, error: e.status === 409 ? 'CONFLICT' : e.status === 403 ? 'MODE_FORBIDDEN' : 'BUSINESS_RULE', message: e.message };
        throw e;
    }
}
