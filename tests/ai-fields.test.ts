import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const testDir = path.resolve('.test-data', `ai-fields-${randomUUID()}`);
process.env.DATA_DIR = testDir;
process.env.DATABASE_URL = `file:${path.join(testDir, 'garden.db').replaceAll('\\', '/')}`;
let store: typeof import('../src/lib/store');
let fields: typeof import('../src/lib/ai/fields');
let db: typeof import('../src/lib/db')['db'];
before(async () => { await mkdir(testDir, { recursive: true }); execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, stdio: 'pipe', windowsHide: true }); store = await import('../src/lib/store'); fields = await import('../src/lib/ai/fields'); db = (await import('../src/lib/db')).db; });
after(async () => { await db?.$disconnect(); });
const editable = (r: any) => ({ ...r, links: r.links.map((l: any) => ({ toId: l.toId, relation: l.relation })) });

test('部分修改：只改标题，正文、标签、关联、字段全部保留', async () => {
    const target = await store.createRecord({ kind: 'PROJECT', title: '原项目', body: '重要正文', fields: { outcome: '阶段成果A', stage: '推进', weeklyCommitment: true }, tags: [' tagA ', 'tagB'], links: [] });
    const other = await store.createRecord({ kind: 'NOTE', title: '关联目标' });
    const current = await store.getRecord(target.id);
    await store.updateRecord(target.id, { ...editable(current), links: [{ toId: other.id, relation: 'related' }] });
    const withLink = await store.getRecord(target.id);
    // AI 只提交 stage 一个字段
    const patch = fields.recordPatch.parse({ recordId: target.id, expectedVersion: withLink.version, fields: { stage: '收尾' } });
    const full = fields.buildFullUpdate('PROJECT', withLink, patch);
    assert.equal(full.title, '原项目');
    assert.equal(full.body, '重要正文');
    assert.deepEqual([...full.tags].sort(), ['tagA', 'tagB']);
    assert.deepEqual(full.fields.outcome, '阶段成果A');
    assert.equal(full.fields.weeklyCommitment, true);
    const updated = await store.updateRecord(target.id, full);
    assert.equal(updated.title, '原项目');
    assert.equal(updated.body, '重要正文');
    assert.equal(updated.fields.stage, '收尾');
    assert.equal(updated.fields.outcome, '阶段成果A');
    assert.equal(updated.fields.weeklyCommitment, true);
    assert.deepEqual([...updated.tags].sort(), ['tagA', 'tagB']);
    assert.deepEqual(updated.links.map(l => l.toId), [other.id]);
});

test('明确清空：日期与文本可清空，数值与多数复选拒绝置空', async () => {
    const action = await store.createRecord({ kind: 'ACTION', title: '清理动作', fields: { dueAt: '2026-11-01T00:00:00.000Z', blocker: '等待资料', priority: 2, todayFocus: true } });
    const current = await store.getRecord(action.id);
    const patch = fields.recordPatch.parse({ recordId: action.id, expectedVersion: current.version, fields: { dueAt: null, blocker: null } });
    const updated = await store.updateRecord(action.id, fields.buildFullUpdate('ACTION', current, patch));
    assert.equal(updated.fields.dueAt, null);
    assert.equal(updated.fields.blocker, '');
    assert.equal(updated.fields.priority, 2);
    assert.equal(updated.fields.todayFocus, true);
    assert.throws(() => fields.buildFullUpdate('ACTION', updated, fields.recordPatch.parse({ recordId: action.id, expectedVersion: updated.version, fields: { priority: null } })), (e: any) => e.status === 400);
    assert.throws(() => fields.buildFullUpdate('ACTION', updated, fields.recordPatch.parse({ recordId: action.id, expectedVersion: updated.version, fields: { todayFocus: null } })), (e: any) => e.status === 400);
});

test('白名单：AI 不能触碰 featured 与 selectedAssets，未知字段拒绝', async () => {
    let draft = await store.createRecord({ kind: 'PUBLICATION', title: '公开稿', fields: { slug: 'ai-whitelist-pub' } });
    const current = await store.getRecord(draft.id);
    assert.throws(() => fields.buildFullUpdate('PUBLICATION', current, fields.recordPatch.parse({ recordId: draft.id, expectedVersion: current.version, fields: { featured: true } })), (e: any) => e.status === 400);
    assert.throws(() => fields.buildFullUpdate('PUBLICATION', current, fields.recordPatch.parse({ recordId: draft.id, expectedVersion: current.version, fields: { snapshots: '伪造' } })), (e: any) => e.status === 400);
    draft = await store.updateRecord(draft.id, fields.buildFullUpdate('PUBLICATION', current, fields.recordPatch.parse({ recordId: draft.id, expectedVersion: current.version, body: '只改正文' })));
    assert.equal(draft.body, '只改正文');
    assert.equal(draft.fields.slug, 'ai-whitelist-pub');
    assert.notEqual(draft.fields.featured, true);
});

test('tags/links 未出现保持、出现替换；status 校验沿用业务层', async () => {
    const note = await store.createRecord({ kind: 'NOTE', title: '备注', body: 'N', tags: ['保留'], links: [] });
    const review = await store.createRecord({ kind: 'REVIEW', title: '复盘', body: 'R', tags: ['旧标签'], links: [{ toId: note.id, relation: 'evidence' }] });
    const current = await store.getRecord(review.id);
    const patch = fields.recordPatch.parse({ recordId: review.id, expectedVersion: current.version, status: 'DONE' });
    const done = await store.updateRecord(review.id, fields.buildFullUpdate('REVIEW', current, patch));
    assert.equal(done.status, 'DONE');
    assert.deepEqual(done.tags, ['旧标签']);
    assert.deepEqual(done.links.map(l => l.toId), [note.id]);
    assert.throws(() => fields.buildFullUpdate('REVIEW', done, fields.recordPatch.parse({ recordId: review.id, expectedVersion: done.version, status: 'PUBLISHED' })), (e: any) => e.status === 400);
    const replaced = await store.updateRecord(review.id, fields.buildFullUpdate('REVIEW', done, fields.recordPatch.parse({ recordId: review.id, expectedVersion: done.version, tags: ['新标签'] })));
    assert.deepEqual(replaced.tags, ['新标签']);
});
