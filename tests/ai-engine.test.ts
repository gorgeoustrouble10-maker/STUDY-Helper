import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const testDir = path.resolve('.test-data', `ai-engine-${randomUUID()}`);
process.env.DATA_DIR = testDir;
process.env.DATABASE_URL = `file:${path.join(testDir, 'garden.db').replaceAll('\\', '/')}`;
let db: typeof import('../src/lib/db')['db'];
let tools: typeof import('../src/lib/ai/tools');
let operations: typeof import('../src/lib/ai/operations');
let rateLimit: typeof import('../src/lib/ai/rate-limit');
let lease: typeof import('../src/lib/ai/lease');
let store: typeof import('../src/lib/store');
before(async () => {
    await mkdir(testDir, { recursive: true });
    execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, stdio: 'pipe', windowsHide: true });
    db = (await import('../src/lib/db')).db;
    store = await import('../src/lib/store');
    tools = await import('../src/lib/ai/tools');
    operations = await import('../src/lib/ai/operations');
    rateLimit = await import('../src/lib/ai/rate-limit');
    lease = await import('../src/lib/ai/lease');
});
after(async () => { await db?.$disconnect(); });

async function makeRun(mode: 'ANALYSIS' | 'WORK') {
    const conversation = await db.aiConversation.create({ data: {} });
    const leaseToken = randomUUID();
    const run = await db.aiRun.create({ data: { conversationId: conversation.id, clientTurnId: randomUUID(), mode, provider: 'mock', model: 'mock', sessionHash: 'test', leaseToken, leaseExpiresAt: new Date(Date.now() + 30000), input: '测试', assistantMessageId: randomUUID() } });
    return { conversationId: conversation.id, runId: run.id, leaseToken, ctx: { runId: run.id, mode, leaseToken, usage: { toolCalls: 0, creates: 0 } } as import('../src/lib/ai/tools').ToolContext };
}

test('分析模式拒绝直接新增，读取工具可用', async () => {
    const { ctx } = await makeRun('ANALYSIS');
    const blocked = await tools.executeToolCall(ctx, 'create_record', { kind: 'NOTE', title: '不应创建' });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.error, 'ANALYSIS_MODE_READONLY');
    const listed = await tools.executeToolCall(ctx, 'search_records', { q: '不应创建' });
    assert.equal(listed.ok, true);
    assert.equal((await db.record.count({ where: { title: '不应创建' } })), 0);
});

test('工作模式新增与凭证同事务，撤销新增仅限未修改记录', async () => {
    const { ctx } = await makeRun('WORK');
    const result = await tools.executeToolCall(ctx, 'create_record', { kind: 'NOTE', title: '自动笔记', body: '初始', tags: ['AI'] });
    assert.ok(result.ok);
    const recordId = (result.data as any).recordId;
    const opRow = await db.aiOperation.findFirstOrThrow({ where: { recordId, type: 'create_record', status: 'APPLIED' } });
    const created = await store.getRecord(recordId);
    assert.equal(created.version, 1);
    const undo = await operations.undoCreate(opRow.id);
    assert.equal(undo.status, 'UNDONE');
    assert.notEqual((await store.getRecord(recordId)).deletedAt, null);
    // 修改后的记录不可自动撤销
    const second = await tools.executeToolCall(ctx, 'create_record', { kind: 'NOTE', title: '修改后笔记' });
    assert.ok(second.ok);
    const secondId = (second.data as any).recordId;
    const secondOp = await db.aiOperation.findFirstOrThrow({ where: { recordId: secondId } });
    await store.updateRecord(secondId, { kind: 'NOTE', title: '修改后笔记', body: '已编辑', version: 1, fields: {}, tags: [], links: [] });
    await assert.rejects(() => operations.undoCreate(secondOp.id), (e: any) => e.status === 409);
});

test('修改提议：确认执行且字段保护，重复确认幂等，拒绝不生效', async () => {
    const { ctx } = await makeRun('ANALYSIS');
    const note = await store.createRecord({ kind: 'NOTE', title: '原题', body: '重要正文', tags: ['保留'] });
    const current = await store.getRecord(note.id);
    const proposal = await tools.executeToolCall(ctx, 'propose_record_change', { recordId: note.id, expectedVersion: current.version, title: '新题' });
    assert.ok(proposal.ok);
    const opId = (proposal.data as any).operationId;
    const op = await db.aiOperation.findUniqueOrThrow({ where: { id: opId } });
    // 确认前无修改
    assert.equal((await store.getRecord(note.id)).title, '原题');
    const applied = await operations.decideOperation(opId, 'confirm', op.hash);
    assert.equal(applied.status, 'APPLIED');
    const after = await store.getRecord(note.id);
    assert.equal(after.title, '新题');
    assert.equal(after.body, '重要正文');
    assert.deepEqual(after.tags, ['保留']);
    assert.equal(after.version, current.version + 1);
    // 重复确认只返回已有结果
    const again = await operations.decideOperation(opId, 'confirm', op.hash);
    assert.equal(again.status, 'APPLIED');
    assert.equal((await store.getRecord(note.id)).version, current.version + 1);
    // 拒绝路径
    const rejectRun = await makeRun('ANALYSIS');
    const other = await store.createRecord({ kind: 'NOTE', title: '拒绝对象', body: '保持' });
    const p2 = await tools.executeToolCall(rejectRun.ctx, 'propose_record_change', { recordId: other.id, expectedVersion: 1, body: '不应写入' });
    assert.ok(p2.ok);
    const op2 = await db.aiOperation.findUniqueOrThrow({ where: { id: (p2.data as any).operationId } });
    const rejected = await operations.decideOperation(op2.id, 'reject', op2.hash);
    assert.equal(rejected.status, 'REJECTED');
    assert.equal((await store.getRecord(other.id)).body, '保持');
    const reReject = await operations.decideOperation(op2.id, 'reject', op2.hash);
    assert.equal(reReject.status, 'REJECTED');
});

test('哈希篡改与过期提议不能执行', async () => {
    const { ctx } = await makeRun('ANALYSIS');
    const note = await store.createRecord({ kind: 'NOTE', title: '安全对象' });
    const p = await tools.executeToolCall(ctx, 'propose_record_change', { recordId: note.id, expectedVersion: 1, body: 'x' });
    assert.ok(p.ok);
    const opId = (p.data as any).operationId;
    await assert.rejects(() => operations.decideOperation(opId, 'confirm', '0'.repeat(64)), (e: any) => e.status === 400);
    assert.equal((await store.getRecord(note.id)).body, '');
    const p2 = await tools.executeToolCall(ctx, 'propose_record_change', { recordId: note.id, expectedVersion: 1, body: 'y' });
    assert.ok(p2.ok);
    const op2Id = (p2.data as any).operationId;
    await db.aiOperation.update({ where: { id: op2Id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await assert.rejects(async () => operations.decideOperation(op2Id, 'confirm', (await db.aiOperation.findUniqueOrThrow({ where: { id: op2Id } })).hash), (e: any) => e.status === 409);
    assert.equal((await db.aiOperation.findUniqueOrThrow({ where: { id: op2Id } })).status, 'EXPIRED');
});

test('版本冲突保留提议并携带最新差异', async () => {
    const { ctx } = await makeRun('ANALYSIS');
    const note = await store.createRecord({ kind: 'NOTE', title: '冲突对象', body: '第一版' });
    const p = await tools.executeToolCall(ctx, 'propose_record_change', { recordId: note.id, expectedVersion: 1, title: 'AI 改题' });
    assert.ok(p.ok);
    const opId = (p.data as any).operationId;
    await store.updateRecord(note.id, { kind: 'NOTE', title: '人工改题', body: '第二版', version: 1, fields: {}, tags: [], links: [] });
    const op = await db.aiOperation.findUniqueOrThrow({ where: { id: opId } });
    await assert.rejects(() => operations.decideOperation(opId, 'confirm', op.hash), (e: any) => e.status === 409);
    const conflicted = await db.aiOperation.findUniqueOrThrow({ where: { id: opId } });
    assert.equal(conflicted.status, 'CONFLICTED');
    const result = JSON.parse(conflicted.result!);
    assert.equal(result.latest.title, '人工改题');
    assert.equal((await store.getRecord(note.id)).title, '人工改题');
});

test('标签合并不加版本时仍能检测内容冲突', async () => {
    const { ctx } = await makeRun('ANALYSIS');
    const note = await store.createRecord({ kind: 'NOTE', title: '标签合并对象', tags: ['旧标签'] });
    const p = await tools.executeToolCall(ctx, 'propose_record_change', { recordId: note.id, expectedVersion: 1, tags: ['旧标签', '追加'] });
    assert.ok(p.ok);
    const opId = (p.data as any).operationId;
    const oldTag = await db.tag.findUniqueOrThrow({ where: { name: '旧标签' } });
    const newTag = await db.tag.create({ data: { name: '合并目标' } });
    await db.recordTag.updateMany({ where: { tagId: oldTag.id }, data: { tagId: newTag.id } });
    const op = await db.aiOperation.findUniqueOrThrow({ where: { id: opId } });
    await assert.rejects(() => operations.decideOperation(opId, 'confirm', op.hash), (e: any) => e.status === 409);
    assert.equal((await db.aiOperation.findUniqueOrThrow({ where: { id: opId } })).status, 'CONFLICTED');
    const current = await store.getRecord(note.id);
    assert.deepEqual([...current.tags].sort(), ['合并目标']);
    assert.equal(current.version, 1);
});

test('完成重复行动的提议确认后生成唯一后继', async () => {
    const { ctx } = await makeRun('ANALYSIS');
    const action = await store.createRecord({ kind: 'ACTION', title: '每日练习', fields: { repeat: 'DAILY', plannedAt: '2026-10-14T01:00:00.000Z' } });
    const p = await tools.executeToolCall(ctx, 'propose_record_operation', { recordId: action.id, expectedVersion: 1, operation: 'complete' });
    assert.ok(p.ok);
    if (p.ok) assert.match(String((p.data as any).note), /下一次实例/);
    const op = await db.aiOperation.findUniqueOrThrow({ where: { id: (p.data as any).operationId } });
    const applied = await operations.decideOperation(op.id, 'confirm', op.hash);
    assert.equal(applied.status, 'APPLIED');
    const successors = await db.action.findMany({ where: { previousId: action.id } });
    assert.equal(successors.length, 1);
    assert.equal(successors[0].plannedAt?.toISOString(), '2026-10-15T01:00:00.000Z');
});

test('相同 toolCallId 重复执行只产生一条记录（幂等重放）', async () => {
    const { ctx } = await makeRun('WORK');
    const toolCallId = randomUUID();
    const args = { kind: 'NOTE' as const, title: '幂等对象' };
    const first = await tools.executeToolCall(ctx, 'create_record', args, toolCallId);
    const second = await tools.executeToolCall(ctx, 'create_record', args, toolCallId);
    assert.ok(first.ok && second.ok);
    if (first.ok && second.ok) {
        assert.equal((second.data as any).replayed, true);
        assert.equal((second.data as any).operationId, (first.data as any).operationId);
    }
    assert.equal(await db.record.count({ where: { title: '幂等对象', deletedAt: null } }), 1);
});

test('业务规则失败时无记录、无凭证残留', async () => {
    const { ctx } = await makeRun('WORK');
    const bad = await tools.executeToolCall(ctx, 'create_record', { kind: 'TRANSACTION', title: '无效交易', fields: { accountId: '不存在', amountCents: 1000 } });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error, 'BUSINESS_RULE');
    assert.equal(await db.record.count({ where: { title: '无效交易' } }), 0);
    assert.equal(await db.aiOperation.count({ where: { runId: ctx.runId } }), 0);
});

test('白名单拦截：AI 不能设置 featured', async () => {
    const { ctx } = await makeRun('WORK');
    const result = await tools.executeToolCall(ctx, 'create_record', { kind: 'PUBLICATION', title: '越权草稿', fields: { featured: true } });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'BUSINESS_RULE');
    assert.equal(await db.record.count({ where: { title: '越权草稿' } }), 0);
});

test('工具调用次数与新增条数限制', async () => {
    const { ctx } = await makeRun('WORK');
    for (let i = 0; i < tools.LIMITS.toolCalls; i++)
        await tools.executeToolCall(ctx, 'search_records', {});
    const exceeded = await tools.executeToolCall(ctx, 'search_records', {});
    assert.equal(exceeded.ok, false);
    if (!exceeded.ok) assert.equal(exceeded.error, 'LIMIT_REACHED');
    const fresh = await makeRun('WORK');
    fresh.ctx.usage.creates = tools.LIMITS.creates;
    const createExceeded = await tools.executeToolCall(fresh.ctx, 'create_record', { kind: 'NOTE', title: '超限' });
    assert.equal(createExceeded.ok, false);
    if (!createExceeded.ok) assert.equal(createExceeded.error, 'BUSINESS_RULE');
});

test('持久限速：窗口内超限返回429', async () => {
    const key = `test:${randomUUID()}`;
    await rateLimit.checkRateLimit(key, 2, 60000);
    await rateLimit.checkRateLimit(key, 2, 60000);
    await assert.rejects(() => rateLimit.checkRateLimit(key, 2, 60000), (e: any) => e.status === 429);
});

test('运行租约：独占、续期身份校验与释放', async () => {
    const conversation = await db.aiConversation.create({ data: {} });
    const runA = await db.aiRun.create({ data: { conversationId: conversation.id, clientTurnId: randomUUID(), mode: 'WORK', provider: 'mock', model: 'mock', sessionHash: 't', leaseToken: 'token-a', leaseExpiresAt: new Date(Date.now() + 30000), input: 'a', assistantMessageId: randomUUID() } });
    await lease.acquireLease(runA.id, 'token-a');
    const runB = await db.aiRun.create({ data: { conversationId: conversation.id, clientTurnId: randomUUID(), mode: 'WORK', provider: 'mock', model: 'mock', sessionHash: 't', leaseToken: 'token-b', leaseExpiresAt: new Date(Date.now() + 30000), input: 'b', assistantMessageId: randomUUID() } });
    await assert.rejects(() => lease.acquireLease(runB.id, 'token-b'), (e: any) => e.status === 409);
    assert.equal(await lease.verifyLease(runA.id, 'token-a'), true);
    assert.equal(await lease.verifyLease(runA.id, 'token-b'), false);
    assert.equal(await lease.renewLease(runA.id, 'token-b'), false);
    assert.equal(await lease.renewLease(runA.id, 'token-a'), true);
    await lease.releaseLease(runA.id, 'token-a', 'CANCELLED');
    assert.equal(await lease.verifyLease(runA.id, 'token-a'), false);
    // 租约过期后新运行可以接管，旧运行被标记中断
    await db.aiRun.update({ where: { id: runA.id }, data: { status: 'RUNNING', leaseToken: 'token-a', leaseExpiresAt: new Date(Date.now() - 1000) } });
    await db.aiRun.update({ where: { id: runB.id }, data: { status: 'RUNNING' } });
    await lease.acquireLease(runB.id, 'token-b');
    const interrupted = await db.aiRun.findUniqueOrThrow({ where: { id: runA.id } });
    assert.equal(interrupted.status, 'INTERRUPTED');
});

test('快照提议确认：引用证据生成快照', async () => {
    const { ctx } = await makeRun('ANALYSIS');
    const note = await store.createRecord({ kind: 'NOTE', title: '证据记录', body: '当时事实' });
    const review = await store.createRecord({ kind: 'REVIEW', title: '快照复盘', links: [{ toId: note.id, relation: 'evidence' }] });
    const p = await tools.executeToolCall(ctx, 'propose_review_snapshot', { recordId: review.id, expectedVersion: 1 });
    assert.ok(p.ok);
    if (p.ok) assert.deepEqual((p.data as any).evidenceIds, [note.id]);
    const op = await db.aiOperation.findUniqueOrThrow({ where: { id: (p.data as any).operationId } });
    const applied = await operations.decideOperation(op.id, 'confirm', op.hash);
    assert.equal(applied.status, 'APPLIED');
    const snapshots = JSON.parse(String((await store.getRecord(review.id)).fields.snapshots));
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].body, '当时事实');
});
