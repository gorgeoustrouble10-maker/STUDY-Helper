import { createHash } from 'node:crypto';
import { db } from '../db';
import { AppError, getRecord, updateRecord, recordOperation, snapshotReview } from '../store';
import type { GardenRecord } from '../types';
import { buildFullUpdate, recordPatch, type RecordPatch } from './fields';

export const PROPOSAL_TTL_MS = 24 * 3600 * 1000;
export const APPLIED_RETENTION_MS = 30 * 24 * 3600 * 1000;

export type OperationType = 'create_record' | 'draft_publication' | 'propose_change' | 'propose_operation' | 'propose_snapshot';
export type OperationStatus = 'PROPOSED' | 'APPLIED' | 'REJECTED' | 'EXPIRED' | 'CONFLICTED' | 'UNDONE';

// 哈希覆盖操作类型、目标与完整参数。确认接口只接收操作 ID + 决定 + 预期哈希，不接收修改正文。
export function operationHash(type: string, recordId: string | null, expectedVersion: number | null, payload: string) {
    return createHash('sha256').update(`${type}|${recordId ?? ''}|${expectedVersion ?? ''}|${payload}`).digest('hex');
}

export async function expireStaleProposals() {
    await db.aiOperation.updateMany({ where: { status: 'PROPOSED', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
}

export type NewProposal = {
    runId: string;
    toolCallId: string;
    type: OperationType;
    recordId?: string;
    expectedVersion?: number;
    payload: unknown;
    before?: unknown;
};

export async function createProposal(input: NewProposal) {
    const payload = JSON.stringify(input.payload);
    const row = await db.aiOperation.create({ data: {
        runId: input.runId,
        toolCallId: input.toolCallId,
        type: input.type,
        status: 'PROPOSED',
        payload,
        hash: operationHash(input.type, input.recordId ?? null, input.expectedVersion ?? null, payload),
        recordId: input.recordId,
        expectedVersion: input.expectedVersion,
        before: input.before === undefined ? '{}' : JSON.stringify(input.before),
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
    } });
    return row;
}

// 记录 APPLIED 凭证（新增类操作）：与业务写入同事务提交，保证"同一操作身份不重复执行"。
export async function createAppliedOperation(tx: any, input: Omit<NewProposal, 'before'>, result: unknown, recordId: string) {
    const payload = JSON.stringify(input.payload);
    return tx.aiOperation.create({ data: {
        runId: input.runId,
        toolCallId: input.toolCallId,
        type: input.type,
        status: 'APPLIED',
        payload,
        hash: operationHash(input.type, recordId, null, payload),
        recordId,
        before: '{}',
        result: JSON.stringify(result),
        expiresAt: new Date(Date.now() + APPLIED_RETENTION_MS),
    } });
}

// 幂等重放：同 runId+toolCallId 的重复调用直接返回已有凭证。
export async function findExistingOperation(runId: string, toolCallId: string) {
    return db.aiOperation.findUnique({ where: { runId_toolCallId: { runId, toolCallId } } });
}

const linksKey = (record: { links: { toId: string; relation: string }[] }) => record.links.map(l => `${l.toId}|${l.relation}`).sort().join(',');
const tagsKey = (record: { tags: string[] }) => [...record.tags].sort().join(',');

// 额外比较被修改字段的原值：覆盖标签合并等不增加记录版本的变化。
function contentDiffers(type: OperationType, current: GardenRecord, before: any, patch?: RecordPatch): string | null {
    if (patch) {
        if (patch.title !== undefined && current.title !== before.title)
            return '标题';
        if (patch.body !== undefined && current.body !== before.body)
            return '正文';
        if (patch.status !== undefined && current.status !== before.status)
            return '状态';
        if (patch.tags !== undefined && tagsKey(current) !== tagsKey({ tags: before.tags ?? [] }))
            return '标签';
        if (patch.links !== undefined && linksKey(current) !== linksKey({ links: before.links ?? [] }))
            return '关联';
        if (patch.fields) {
            for (const key of Object.keys(patch.fields))
                if (JSON.stringify(current.fields[key] ?? null) !== JSON.stringify(before.fields?.[key] ?? null))
                    return `字段 ${key}`;
        }
        return null;
    }
    if (type === 'propose_operation' && (current.status !== before.status || current.archivedAt !== before.archivedAt || current.deletedAt !== before.deletedAt))
        return '记录状态';
    if (type === 'propose_snapshot' && (linksKey(current) !== linksKey({ links: before.links ?? [] }) || current.deletedAt))
        return '复盘引用';
    return null;
}

function latestSummary(record: GardenRecord) {
    return { id: record.id, kind: record.kind, title: record.title, status: record.status, version: record.version, body: record.body.slice(0, 2000), fields: record.fields, tags: record.tags, links: record.links };
}

export type DecisionResult = { id: string; status: OperationStatus; result?: unknown };

// 确认/拒绝。重复确认只返回已有结果；冲突时保留提议并携带最新内容。
export async function decideOperation(operationId: string, decision: 'confirm' | 'reject', expectedHash: string): Promise<DecisionResult> {
    await expireStaleProposals();
    const op = await db.aiOperation.findUnique({ where: { id: operationId } });
    if (!op)
        throw new AppError(404, '操作不存在');
    if (op.hash !== expectedHash)
        throw new AppError(400, '操作内容与确认时不一致，请刷新后重新确认');
    if (op.status === 'APPLIED' || op.status === 'REJECTED')
        return { id: op.id, status: op.status, result: op.result ? JSON.parse(op.result) : undefined };
    if (op.status !== 'PROPOSED')
        throw new AppError(409, `提议当前状态为 ${op.status}，无法${decision === 'confirm' ? '执行' : '拒绝'}`);
    if (decision === 'reject') {
        await db.aiOperation.updateMany({ where: { id: op.id, status: 'PROPOSED' }, data: { status: 'REJECTED' } });
        return { id: op.id, status: 'REJECTED' };
    }
    const payload = JSON.parse(op.payload);
    const before = JSON.parse(op.before || '{}');
    let latest: GardenRecord | null = null;
    let conflictField: string | null = null;
    const applied = await db.$transaction(async (tx) => {
        const current = await getRecord(op.recordId!, tx);
        if (current.deletedAt) {
            latest = current;
            conflictField = '记录已删除';
            return null;
        }
        if (current.version !== op.expectedVersion) {
            latest = current;
            conflictField = '版本';
            return null;
        }
        conflictField = contentDiffers(op.type as OperationType, current, before, op.type === 'propose_change' ? recordPatch.parse(payload) : undefined);
        if (conflictField) {
            latest = current;
            return null;
        }
        if (op.type === 'propose_change') {
            const full = buildFullUpdate(current.kind, current, recordPatch.parse(payload));
            const result = await updateRecord(op.recordId!, full, tx);
            await tx.aiOperation.update({ where: { id: op.id }, data: { status: 'APPLIED', result: JSON.stringify({ recordId: result.id, version: result.version }) } });
            return result;
        }
        if (op.type === 'propose_operation') {
            const result = await recordOperation(op.recordId!, String(payload.operation), op.expectedVersion!, tx);
            await tx.aiOperation.update({ where: { id: op.id }, data: { status: 'APPLIED', result: JSON.stringify({ recordId: result.id, version: result.version, status: result.status }) } });
            return result;
        }
        const result = await snapshotReview(op.recordId!, op.expectedVersion!, tx);
        await tx.aiOperation.update({ where: { id: op.id }, data: { status: 'APPLIED', result: JSON.stringify({ recordId: result.id, version: result.version }) } });
        return result;
    }).catch((e: unknown) => {
        if (e instanceof AppError && e.status === 404)
            throw e;
        throw e;
    });
    if (!applied) {
        await db.aiOperation.updateMany({ where: { id: op.id, status: 'PROPOSED' }, data: { status: 'CONFLICTED', result: JSON.stringify({ conflictField, latest: latest ? latestSummary(latest) : null }) } });
        throw new AppError(409, `记录已发生变化（${conflictField}）。提议已保留，请查看最新差异后重新处理。`, latest ? latestSummary(latest) : undefined);
    }
    return { id: op.id, status: 'APPLIED', result: { recordId: applied.id, version: applied.version } };
}

// 人工撤销自动新增：仅当记录创建后未被修改、无修订、无任何关联时，移入回收站。
export async function undoCreate(operationId: string) {
    const op = await db.aiOperation.findUnique({ where: { id: operationId } });
    if (!op)
        throw new AppError(404, '操作不存在');
    if (op.type !== 'create_record' && op.type !== 'draft_publication')
        throw new AppError(400, '只有自动新增的记录支持撤销');
    if (op.status === 'UNDONE')
        return { id: op.id, status: 'UNDONE' as const };
    if (op.status !== 'APPLIED')
        throw new AppError(409, `操作状态为 ${op.status}，无法撤销`);
    const result = JSON.parse(op.result || '{}');
    const recordId = String(result.recordId || '');
    if (!recordId)
        throw new AppError(409, '操作缺少记录标识，无法撤销');
    const record = await getRecord(recordId);
    if (record.deletedAt) {
        await db.aiOperation.updateMany({ where: { id: op.id }, data: { status: 'UNDONE' } });
        return { id: op.id, status: 'UNDONE' as const };
    }
    if (record.version !== Number(result.version ?? 1))
        throw new AppError(409, '记录创建后已被修改，不能自动撤销，请手动处理');
    const [revisions, links, published] = await Promise.all([
        db.revision.count({ where: { recordId } }),
        db.recordLink.count({ where: { OR: [{ fromId: recordId }, { toId: recordId }] } }),
        record.kind === 'PUBLICATION' ? db.publishedVersion.count({ where: { publicationId: recordId } }) : Promise.resolve(0),
    ]);
    if (revisions || links || published)
        throw new AppError(409, '记录已有修订、关联或发布历史，不能自动撤销，请手动处理');
    await recordOperation(recordId, 'delete', record.version);
    await db.aiOperation.updateMany({ where: { id: op.id }, data: { status: 'UNDONE' } });
    return { id: op.id, status: 'UNDONE' as const };
}
