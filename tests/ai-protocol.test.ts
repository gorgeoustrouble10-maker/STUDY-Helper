import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startMockLlm } from '../scripts/mock-llm.mjs';

const testDir = path.resolve('.test-data', `ai-protocol-${randomUUID()}`);
process.env.DATA_DIR = testDir;
process.env.DATABASE_URL = `file:${path.join(testDir, 'garden.db').replaceAll('\\', '/')}`;
process.env.AI_ENABLED = 'true';
process.env.AI_PROVIDER = 'openai-compatible';
process.env.AI_API_KEY = 'mock-key';
process.env.AI_MODEL = 'mock-model';

const mock = startMockLlm();
const mockPort = await mock.ready;
process.env.AI_BASE_URL = `http://127.0.0.1:${mockPort}/v1`;

let run: typeof import('../src/lib/ai/run');
let db: typeof import('../src/lib/db')['db'];
let store: typeof import('../src/lib/store');
before(async () => {
    await mkdir(testDir, { recursive: true });
    execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, stdio: 'pipe', windowsHide: true });
    db = (await import('../src/lib/db')).db;
    store = await import('../src/lib/store');
    run = await import('../src/lib/ai/run');
    run.AI_LIMITS.rateMax = 10000;
});
after(async () => { await db?.$disconnect(); mock.server.close(); });

async function consumeChat(text: string, mode: 'ANALYSIS' | 'WORK' = 'WORK') {
    const response = await run.startChatRun({ clientTurnId: randomUUID(), mode, text });
    const reader = (response.body as ReadableStream).getReader();
    const decoder = new TextDecoder();
    let raw = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return { response, raw };
}

async function waitFor<T>(fn: () => Promise<T | null>, ms = 6000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
        const value = await fn();
        if (value !== null)
            return value;
        if (Date.now() > end)
            throw new Error('等待超时');
        await new Promise(r => setTimeout(r, 200));
    }
}

test('文本轮：中文分片流式返回，运行与消息持久化', async () => {
    const { raw } = await consumeChat('[scenario:default] 你好');
    assert.match(raw, /"type":/);
    assert.ok(raw.includes('你好') || raw.includes('工作台助手'));
    const conversation = await db.aiConversation.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    const messages = await db.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } });
    assert.equal(messages[0].role, 'user');
    const assistant = messages.find(m => m.role === 'assistant');
    assert.ok(assistant, '助手消息应已持久化');
    const runRow = await db.aiRun.findFirstOrThrow({ where: { conversationId: conversation.id } });
    assert.equal(runRow.status, 'COMPLETE');
});

test('工具调用：参数分片解析，创建与凭证落库', async () => {
    const { raw } = await consumeChat('[scenario:tool-create] 记录一件事');
    assert.ok(raw.length > 0);
    const record = await waitFor(() => db.record.findFirst({ where: { title: '模拟记录', deletedAt: null } }));
    assert.equal(record!.kind, 'NOTE');
    assert.equal(record!.body, '来自模拟模型');
    const op = await db.aiOperation.findFirstOrThrow({ where: { recordId: record!.id } });
    assert.equal(op.status, 'APPLIED');
    const runRow = await db.aiRun.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    assert.equal(runRow.status, 'COMPLETE');
    assert.ok(runRow.toolCount >= 1);
    const assistant = await db.aiMessage.findFirst({ where: { role: 'assistant', conversationId: runRow.conversationId }, orderBy: { createdAt: 'desc' } });
    assert.ok(assistant);
});

test('分析模式：写入类工具被拒且不创建记录', async () => {
    await consumeChat('[scenario:tool-create] 分析模式下试试写入', 'ANALYSIS');
    const record = await db.record.findFirst({ where: { title: '模拟记录', kind: 'NOTE', deletedAt: null, body: '来自模拟模型' } });
    // 只应有一条（上一测试创建的），本次分析模式不应新增
    assert.equal(record!.id, (await db.record.findFirstOrThrow({ where: { title: '模拟记录' } })).id);
    const count = await db.record.count({ where: { title: '模拟记录' } });
    assert.equal(count, 1);
});

test('一轮多个工具调用：并行创建两条记录', async () => {
    await consumeChat('[scenario:multi-tool] 一次建两条');
    await waitFor(async () => (await db.record.count({ where: { title: { in: ['并行一', '并行二'] }, deletedAt: null } })) === 2 ? true : null);
    assert.equal(await db.record.count({ where: { title: '并行一' } }), 1);
    assert.equal(await db.record.count({ where: { title: '并行二' } }), 1);
});

test('思考模式字段（reasoning_content）不破坏解析', async () => {
    const { raw } = await consumeChat('[scenario:reasoning] 带思考回答');
    assert.ok(raw.length > 0);
    const runRow = await waitFor(async () => {
        const row = await db.aiRun.findFirst({ orderBy: { createdAt: 'desc' } });
        return row && row.status !== 'RUNNING' ? row : null;
    });
    assert.equal(runRow!.status, 'COMPLETE');
});

test('异常响应：损坏 JSON 响应体，运行收敛为失败状态', async () => {
    await consumeChat('[scenario:bad-json] 坏数据');
    const runRow = await waitFor(async () => {
        const row = await db.aiRun.findFirst({ orderBy: { createdAt: 'desc' } });
        return row && row.status === 'FAILED' ? row : null;
    }, 12000);
    assert.equal(runRow!.errorCode, 'STREAM_ERROR');
});

test('异常工具参数：无部分写入残留，错误在流中可见', async () => {
    const { raw } = await consumeChat('[scenario:bad-tool-args] 参数损坏');
    assert.match(raw, /tool-input-error/);
    const record = await db.record.findFirst({ where: { title: '坏JSON' } });
    assert.equal(record, null, '损坏参数绝不产生部分写入');
    await waitFor(async () => {
        const row = await db.aiRun.findFirst({ orderBy: { createdAt: 'desc' } });
        return row && row.status !== 'RUNNING' ? row : null;
    });
});

test('断流：连接中断后运行收敛为失败状态', async () => {
    await consumeChat('[scenario:stream-break] 中断我');
    const runRow = await waitFor(async () => {
        const row = await db.aiRun.findFirst({ orderBy: { createdAt: 'desc' } });
        return row && row.status === 'FAILED' ? row : null;
    });
    assert.equal(runRow!.errorCode, 'STREAM_ERROR');
});

test('重复 clientTurnId 返回冲突（幂等保护）', async () => {
    const clientTurnId = randomUUID();
    const first = await run.startChatRun({ clientTurnId, mode: 'WORK', text: '第一轮' });
    assert.equal(first.status, 200);
    await assert.rejects(() => run.startChatRun({ clientTurnId, mode: 'WORK', text: '重复提交' }), (e: any) => e.status === 409);
    await run.cancelRun((await db.aiRun.findFirstOrThrow({ where: { clientTurnId } })).id);
});
