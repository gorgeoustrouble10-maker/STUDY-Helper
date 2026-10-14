import { db } from './db';
import { definitions, type Kind, type GardenRecord, type PublicContent } from './types';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from './db';
export class AppError extends Error {
    constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
const modelNames: Record<Kind, string | undefined> = { DOMAIN: 'domain', COURSE: 'course', PROJECT: 'project', ACTION: 'action', ISSUE: 'issue', NOTE: undefined, RESOURCE: 'resource', REVIEW: 'review', PERSON: 'person', ITEM: 'item', ACCOUNT: 'account', TRANSACTION: 'transaction', BUDGET: 'budget', CHANNEL: 'channel', PUBLICATION: 'publication' };
export const recordInclude = { domain: true, course: true, project: true, action: true, issue: true, resource: true, review: true, person: true, item: true, account: true, transaction: true, budget: true, channel: true, publication: true, tags: { include: { tag: true } }, outgoing: { include: { to: true } }, incoming: { include: { from: true } }, attachments: true } as const;
type Client = any;
const baseInput = z.object({ kind: z.enum(Object.keys(definitions) as [
        Kind,
        ...Kind[]
    ]), title: z.string().trim().min(1, '请填写标题').max(200), body: z.string().max(500000).default(''), status: z.string().optional(), version: z.number().int().positive().optional(), fields: z.record(z.string(), z.unknown()).default({}), tags: z.array(z.string().max(60)).max(30).default([]), links: z.array(z.object({ toId: z.string(), relation: z.enum(['related', 'source', 'action', 'evidence', 'chapter', 'assignment']).default('related') })).max(100).default([]) });
const text = (value: unknown) => typeof value === 'string' ? value : '';
function validatedFields(kind: Kind, input: Record<string, unknown>) {
    const output: Record<string, unknown> = {};
    for (const field of definitions[kind].fields) {
        if (kind === 'PUBLICATION' && ['recommendationType', 'audience', 'role', 'limitations', 'maturity', 'featured'].includes(field.key))
            continue;
        if (!(field.key in input))
            continue;
        const value = input[field.key];
        if (field.key === 'parentId' && !value) {
            output[field.key] = null;
            continue;
        }
        if (field.type === 'date') {
            if (!value) {
                output[field.key] = null;
                continue;
            }
            const date = new Date(String(value));
            if (!Number.isFinite(date.getTime()))
                throw new AppError(400, `${field.label}不是有效日期`);
            output[field.key] = date;
        }
        else if (field.type === 'checkbox') {
            if (typeof value !== 'boolean' && value !== null)
                throw new AppError(400, `${field.label}格式不正确`);
            output[field.key] = value;
        }
        else if (field.type === 'money' || field.type === 'number') {
            if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > 2147483647)
                throw new AppError(400, `${field.label}必须是有效整数`);
            if (['amountCents', 'limitCents', 'quantity'].includes(field.key) && value < 0)
                throw new AppError(400, `${field.label}不能为负数`);
            if (field.key === 'priority' && (value < 1 || value > 3))
                throw new AppError(400, '优先级必须为1至3');
            output[field.key] = value;
        }
        else {
            if (typeof value !== 'string' || value.length > 50000)
                throw new AppError(400, `${field.label}格式不正确`);
            if (field.options && !field.options.includes(value))
                throw new AppError(400, `${field.label}选项不正确`);
            if (field.key === 'url' && value && !/^https?:\/\//i.test(value))
                throw new AppError(400, '来源地址必须使用 http 或 https');
            output[field.key] = value || (['parentId'].includes(field.key) ? null : '');
        }
    }
    if (kind === 'BUDGET' && (!input.period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(input.period))))
        throw new AppError(400, '预算月份请使用 YYYY-MM');
    if (kind === 'PUBLICATION') {
        if (input.slug && !/^[a-z0-9][a-z0-9-]{0,100}$/.test(String(input.slug)))
            throw new AppError(400, '链接标识使用小写字母、数字和短横线');
        const details: Record<string, unknown> = {};
        for (const key of ['recommendationType', 'audience', 'role', 'limitations', 'maturity', 'featured'])
            if (key in input)
                details[key] = key === 'featured' ? Boolean(input[key]) : text(input[key]).slice(0, 20000);
        output.details = JSON.stringify(details);
        const selected = Array.isArray(input.selectedAssets) ? input.selectedAssets : typeof input.selectedAssets === 'string' ? JSON.parse(input.selectedAssets) : [];
        if (!Array.isArray(selected) || selected.some(x => typeof x !== 'string') || selected.length > 40)
            throw new AppError(400, '附件选择无效');
        output.selectedAssets = JSON.stringify(selected);
    }
    return output;
}
export function serializeRecord(row: any): GardenRecord {
    const fields = { ...(modelNames[row.kind as Kind] ? row[modelNames[row.kind as Kind]!] : {}) };
    delete fields.recordId;
    if (row.kind === 'PUBLICATION') {
        Object.assign(fields, JSON.parse(fields.details || '{}'));
        delete fields.details;
        fields.selectedAssets = JSON.parse(fields.selectedAssets || '[]');
    }
    return JSON.parse(JSON.stringify({ id: row.id, kind: row.kind, title: row.title, body: row.body, status: row.status, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt, archivedAt: row.archivedAt, deletedAt: row.deletedAt, fields,
        tags: (row.tags || []).map((t: any) => t.tag.name), links: (row.outgoing || []).map((l: any) => ({ id: l.id, toId: l.toId, title: l.to.title, kind: l.to.kind, relation: l.relation })), backlinks: (row.incoming || []).map((l: any) => ({ id: l.id, fromId: l.fromId, title: l.from.title, kind: l.from.kind, relation: l.relation })), attachments: (row.attachments || []).map((a: any) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size })) }));
}
export async function getRecord(id: string, client: Client = db) {
    const row = await client.record.findUnique({ where: { id }, include: recordInclude });
    if (!row)
        throw new AppError(404, '记录不存在');
    return serializeRecord(row);
}
async function saveRelations(client: Client, id: string, tags: string[], links: {
    toId: string;
    relation: string;
}[]) {
    const existing = await client.recordLink.findMany({ where: { fromId: id } });
    for (const link of links) {
        if (link.toId === id)
            throw new AppError(400, '不能关联自身');
        const target = await client.record.findUnique({ where: { id: link.toId } });
        if (!target || (target.deletedAt && !existing.some((x: any) => x.toId === link.toId && x.relation === link.relation)))
            throw new AppError(400, '关联对象不存在或已删除');
    }
    await client.recordTag.deleteMany({ where: { recordId: id } });
    for (const name of [...new Set(tags.map(t => t.trim()).filter(Boolean))]) {
        const tag = await client.tag.upsert({ where: { name }, create: { name }, update: {} });
        await client.recordTag.create({ data: { recordId: id, tagId: tag.id } });
    }
    await client.recordLink.deleteMany({ where: { fromId: id } });
    for (const link of links)
        await client.recordLink.upsert({ where: { fromId_toId_relation: { fromId: id, toId: link.toId, relation: link.relation } }, create: { fromId: id, ...link }, update: {} });
}
async function saveFields(client: Client, id: string, kind: Kind, input: Record<string, unknown>) {
    const model = modelNames[kind];
    if (!model)
        return;
    const fields = validatedFields(kind, input);
    if (kind === 'TRANSACTION') {
        const account = await client.record.findFirst({ where: { id: fields.accountId, kind: 'ACCOUNT', deletedAt: null } });
        if (!account)
            throw new AppError(400, '请选择有效账户');
        if (!fields.amountCents || Number(fields.amountCents) <= 0)
            throw new AppError(400, '收支金额必须大于零');
        if ('occurredAt' in fields && !fields.occurredAt)
            throw new AppError(400, '发生时间不能为空');
    }
    if (kind === 'ACTION' && fields.parentId) {
        const parent = await client.record.findFirst({ where: { id: fields.parentId, kind: 'ACTION', deletedAt: null } });
        if (!parent || parent.id === id)
            throw new AppError(400, '父行动无效');
        let cursor = parent.id;
        const visited = new Set([id]);
        while (cursor) {
            if (visited.has(cursor))
                throw new AppError(400, '父行动存在循环');
            visited.add(cursor);
            const a = await client.action.findUnique({ where: { recordId: cursor } });
            cursor = a?.parentId || '';
        }
    }
    if (kind === 'PUBLICATION') {
        const old = await client.publication.findUnique({ where: { recordId: id } });
        if (old && await client.publishedVersion.count({ where: { publicationId: id } })) {
            if (fields.slug && fields.slug !== old.slug)
                throw new AppError(400, '已发布内容的稳定链接不能更改');
            if (fields.publicationType && fields.publicationType !== old.publicationType)
                throw new AppError(400, '已发布内容的类型不能更改，请建立新的公开稿');
        }
        if (!fields.slug)
            fields.slug = old?.slug || `entry-${id.slice(0, 8)}`;
    }
    const defaults: Record<string, unknown> = kind === 'TRANSACTION' ? { accountId: fields.accountId, amountCents: fields.amountCents } : kind === 'BUDGET' ? { period: fields.period, limitCents: fields.limitCents } : {};
    await client[model].upsert({ where: { recordId: id }, create: { recordId: id, ...defaults, ...fields }, update: fields });
}
export async function createRecord(raw: unknown, client: Client = db) {
    const input = baseInput.parse(raw);
    if (input.status && !definitions[input.kind].statuses.includes(input.status))
        throw new AppError(400, '状态不适用于这类记录');
    const run = async (tx: Client) => {
        const row = await tx.record.create({ data: { kind: input.kind, title: input.title, body: input.body, status: input.kind === 'PUBLICATION' ? 'DRAFT' : input.status || definitions[input.kind].statuses[0] } });
        await saveFields(tx, row.id, input.kind, input.fields);
        await saveRelations(tx, row.id, input.tags, input.links);
        return getRecord(row.id, tx);
    };
    return client === db ? db.$transaction(run) : run(client);
}
export async function updateRecord(id: string, raw: unknown) {
    const input = baseInput.parse(raw);
    if (!input.version)
        throw new AppError(400, '缺少编辑版本');
    return db.$transaction(async (tx) => {
        const old = await getRecord(id, tx);
        if (old.deletedAt)
            throw new AppError(400, '请先从回收站恢复');
        if (old.kind !== input.kind)
            throw new AppError(400, '不能更改记录类型');
        let status = input.status || old.status;
        if (!definitions[input.kind].statuses.includes(status))
            throw new AppError(400, '状态不正确');
        if (input.kind === 'PUBLICATION')
            status = old.fields.currentVersionId ? 'CHANGED' : old.status === 'WITHDRAWN' ? 'WITHDRAWN' : 'DRAFT';
        const updated = await tx.record.updateMany({ where: { id, version: input.version }, data: { title: input.title, body: input.body, status, version: { increment: 1 } } });
        if (!updated.count)
            throw new AppError(409, '这条记录已在其他窗口修改。你的输入已保留，请比较后重新保存。', old);
        await tx.revision.create({ data: { recordId: id, snapshot: JSON.stringify(old) } });
        await saveFields(tx, id, input.kind, input.fields);
        await saveRelations(tx, id, input.tags, input.links);
        if (input.kind === 'ACTION' && status === 'DONE' && old.status !== 'DONE')
            await advanceAction(tx, await getRecord(id, tx));
        if (input.kind === 'ACTION' && status !== 'DONE' && old.status === 'DONE')
            await tx.action.update({ where: { recordId: id }, data: { completedAt: null } });
        return getRecord(id, tx);
    });
}
export function nextOccurrence(value: Date, repeat: string) {
    const result = new Date(value);
    if (repeat === 'DAILY')
        result.setUTCDate(result.getUTCDate() + 1);
    else if (repeat === 'WEEKLY')
        result.setUTCDate(result.getUTCDate() + 7);
    else if (repeat === 'MONTHLY') {
        const day = result.getUTCDate();
        result.setUTCDate(1);
        result.setUTCMonth(result.getUTCMonth() + 1);
        const max = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
        result.setUTCDate(Math.min(day, max));
    }
    return result;
}
async function advanceAction(tx: Client, old: GardenRecord) {
    await tx.action.update({ where: { recordId: old.id }, data: { completedAt: new Date() } });
    if (old.fields.repeat && old.fields.repeat !== 'NONE' && !await tx.action.findUnique({ where: { previousId: old.id } })) {
        const fields: Record<string, unknown> = { ...old.fields, todayFocus: false };
        for (const key of ['plannedAt', 'dueAt', 'remindAt'])
            if (fields[key])
                fields[key] = nextOccurrence(new Date(String(fields[key])), String(fields.repeat));
        if (!fields.plannedAt)
            fields.plannedAt = nextOccurrence(new Date(), String(fields.repeat));
        const next = await createRecord({ kind: 'ACTION', title: old.title, body: old.body, status: 'TODO', fields, tags: old.tags, links: old.links.map(l => ({ toId: l.toId, relation: l.relation })) }, tx);
        await tx.action.update({ where: { recordId: next.id }, data: { previousId: old.id } });
    }
}
export async function recordOperation(id: string, operation: string, version: number) {
    return db.$transaction(async (tx) => {
        const old = await getRecord(id, tx);
        if (operation === 'complete' && old.status === 'DONE')
            return old;
        if (old.version !== version)
            throw new AppError(409, '记录已改变，请刷新后重试', old);
        const changes: any = { version: { increment: 1 } };
        if (operation === 'archive')
            changes.archivedAt = new Date();
        else if (operation === 'unarchive')
            changes.archivedAt = null;
        else if (operation === 'delete') {
            changes.deletedAt = new Date();
            if (old.kind === 'PUBLICATION') {
                await tx.publication.update({ where: { recordId: id }, data: { currentVersionId: null } });
                changes.status = 'WITHDRAWN';
            }
            if (old.kind === 'ACCOUNT' && await tx.transaction.count({ where: { accountId: id, record: { deletedAt: null } } }))
                throw new AppError(400, '账户仍有有效收支，请先处理关联记录');
        }
        else if (operation === 'restore')
            changes.deletedAt = null;
        else if (operation === 'complete') {
            if (!definitions[old.kind].statuses.includes('DONE'))
                throw new AppError(400, '此记录类型不能标记完成');
            changes.status = 'DONE';
        }
        else if (operation === 'reopen')
            changes.status = definitions[old.kind].statuses[0];
        else
            throw new AppError(400, '未知操作');
        await tx.record.update({ where: { id }, data: changes });
        if (operation === 'complete' && old.kind === 'ACTION')
            await advanceAction(tx, old);
        if (operation === 'reopen' && old.kind === 'ACTION')
            await tx.action.update({ where: { recordId: id }, data: { completedAt: null } });
        return getRecord(id, tx);
    });
}
export async function snapshotReview(id: string, version: number) {
    const review = await getRecord(id);
    if (review.kind !== 'REVIEW')
        throw new AppError(400, '仅复盘支持快照');
    const snapshots = await Promise.all(review.links.map(l => getRecord(l.toId)));
    return db.$transaction(async (tx) => { const changed = await tx.record.updateMany({ where: { id, version }, data: { version: { increment: 1 } } }); if (!changed.count)
        throw new AppError(409, '记录已改变'); await tx.review.update({ where: { recordId: id }, data: { snapshots: JSON.stringify(snapshots) } }); return getRecord(id, tx); });
}
export async function listRecords(params: URLSearchParams) {
    const page = Math.max(1, Number(params.get('page')) || 1);
    const size = Math.min(200, Math.max(1, Number(params.get('size')) || 30));
    const where: any = {};
    const view = params.get('view');
    if (view === 'trash')
        where.deletedAt = { not: null };
    else {
        where.deletedAt = null;
        if (view === 'archive')
            where.archivedAt = { not: null };
        else
            where.archivedAt = null;
    }
    const kinds = params.get('kind')?.split(',').filter(k => k in definitions);
    if (kinds?.length)
        where.kind = { in: kinds };
    const q = params.get('q')?.trim();
    if (q)
        where.OR = [{ title: { contains: q } }, { body: { contains: q } }, { tags: { some: { tag: { OR: [{ name: { contains: q } }, { aliases: { contains: q } }] } } } }];
    if (params.get('status'))
        where.status = params.get('status');
    if (params.get('tag'))
        where.tags = { some: { tag: { name: params.get('tag') } } };
    if (params.get('linked'))
        where.AND = [{ OR: [{ outgoing: { some: { toId: params.get('linked') } } }, { incoming: { some: { fromId: params.get('linked') } } }] }];
    const [rows, total] = await db.$transaction([db.record.findMany({ where, include: recordInclude, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * size, take: size }), db.record.count({ where })]);
    return { list: rows.map(serializeRecord), total, page, size, hasMore: page * size < total };
}
export async function publicList() {
    const publications = await db.publication.findMany({ where: { currentVersionId: { not: null }, record: { deletedAt: null } } });
    const result: PublicContent[] = [];
    for (const publication of publications) {
        const version = await db.publishedVersion.findUnique({ where: { id: publication.currentVersionId! }, include: { assets: true } });
        if (!version)
            continue;
        const snapshot = JSON.parse(version.snapshot);
        result.push({ ...snapshot, id: version.id, publishedAt: version.createdAt.toISOString(), assets: version.assets.map(a => ({ id: a.id, name: a.name, mime: a.mime, url: `/api/public/files/${version.id}/${a.id}` })) });
    }
    return result.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
export async function publish(id: string, version: number) {
    const draft = await getRecord(id);
    if (draft.kind !== 'PUBLICATION' || draft.deletedAt)
        throw new AppError(400, '请选择有效公开稿');
    if (draft.version !== version)
        throw new AppError(409, '稿件已改变，请刷新预览');
    const publication = await db.publication.findUniqueOrThrow({ where: { recordId: id } });
    const versionId = randomUUID();
    const assets: any[] = [];
    await mkdir(path.join(dataDir, 'published'), { recursive: true });
    for (const assetId of JSON.parse(publication.selectedAssets)) {
        const asset = await db.attachment.findUnique({ where: { id: assetId }, include: { record: true } });
        if (!asset || asset.record.deletedAt)
            throw new AppError(400, '所选附件已不可用，请重新选择');
        if (asset.recordId !== id && !draft.links.some(l => l.toId === asset.recordId && l.relation === 'source'))
            throw new AppError(400, '附件必须来自当前稿件或已关联的素材');
        const aid = randomUUID();
        const storageKey = `published/${versionId}-${aid}`;
        await copyFile(path.join(dataDir, asset.storageKey), path.join(dataDir, storageKey));
        assets.push({ id: aid, versionId, name: asset.name, mime: asset.mime, storageKey, originalId: assetId });
    }
    let body = draft.body;
    for (const asset of assets)
        body = body.replaceAll(`/api/workspace/files/${asset.originalId}`, `/api/public/files/${versionId}/${asset.id}`);
    if (/\/api\/workspace\/|\/workspace\/|\[\[[^\]]+\]\]/.test(body))
        throw new AppError(400, '正文包含内部引用或未选择的私密附件，请改为公开链接或移除');
    const snapshot = { title: draft.title, body, slug: publication.slug, type: publication.publicationType, summary: publication.summary, tags: draft.tags, details: JSON.parse(publication.details) };
    return db.$transaction(async (tx) => {
        const changed = await tx.record.updateMany({ where: { id, version }, data: { status: 'PUBLISHED', version: { increment: 1 } } });
        if (!changed.count)
            throw new AppError(409, '发布期间稿件已改变，请重新预览');
        await tx.publishedVersion.create({ data: { id: versionId, publicationId: id, snapshot: JSON.stringify(snapshot) } });
        for (const { originalId, ...asset } of assets)
            await tx.publishedAsset.create({ data: asset });
        await tx.publication.update({ where: { recordId: id }, data: { currentVersionId: versionId } });
        return getRecord(id, tx);
    });
}
export async function withdraw(id: string, version: number) { return db.$transaction(async (tx) => { const changed = await tx.record.updateMany({ where: { id, kind: 'PUBLICATION', version }, data: { status: 'WITHDRAWN', version: { increment: 1 } } }); if (!changed.count)
    throw new AppError(409, '稿件已改变'); await tx.publication.update({ where: { recordId: id }, data: { currentVersionId: null } }); return getRecord(id, tx); }); }
export async function restoreRevision(id: string, revisionId: string, version: number) { const revision = await db.revision.findFirst({ where: { id: revisionId, recordId: id } }); if (!revision)
    throw new AppError(404, '版本不存在'); const snapshot = JSON.parse(revision.snapshot); return updateRecord(id, { ...snapshot, version, links: snapshot.links.map((l: any) => ({ toId: l.toId, relation: l.relation })) }); }
export async function restorePublished(id: string, versionId: string, version: number) {
    const snapshot = await db.publishedVersion.findFirst({ where: { id: versionId, publicationId: id }, include: { assets: true } });
    if (!snapshot)
        throw new AppError(404, '发布版本不存在');
    const data = JSON.parse(snapshot.snapshot);
    const old = await getRecord(id);
    if (old.version !== version)
        throw new AppError(409, '稿件已改变');
    let body = data.body;
    const selectedAssets: string[] = [];
    await mkdir(path.join(dataDir, 'uploads'), { recursive: true });
    for (const asset of snapshot.assets) {
        const aid = randomUUID();
        const storageKey = `uploads/${aid}`;
        await copyFile(path.join(dataDir, asset.storageKey), path.join(dataDir, storageKey));
        const stat = await import('node:fs/promises').then(fs => fs.stat(path.join(dataDir, storageKey)));
        await db.attachment.create({ data: { id: aid, recordId: id, name: asset.name, mime: asset.mime, size: stat.size, storageKey } });
        selectedAssets.push(aid);
        body = body.replaceAll(`/api/public/files/${versionId}/${asset.id}`, `/api/workspace/files/${aid}`);
    }
    return updateRecord(id, { ...old, title: data.title, body, version, fields: { ...old.fields, ...data.details, summary: data.summary, publicationType: data.type, slug: data.slug, selectedAssets }, tags: data.tags, links: old.links.map(l => ({ toId: l.toId, relation: l.relation })) });
}
export const defaultProfile = { name: '我的数字花园', tagline: '在生活中实践，在记录中生长。', introduction: '这里是个人介绍的待填写位置。你可以在工作台中写下自己的经历、关注的主题与价值观。', values: '待填写', skills: '待填写', interests: '待填写', boundaries: '待填写', timeline: '待填写', now: '待填写：最近正在关注什么', email: '', links: '', cooperation: '待填写：愿意交流与合作的方向', avatar: '', resume: '' };
export async function getProfile() { const row = await db.setting.findUnique({ where: { key: 'profile' } }); return { ...defaultProfile, ...(row ? JSON.parse(row.value) : {}) }; }
export async function saveProfile(input: Record<string, unknown>) { const profile: Record<string, string> = {}; for (const key of Object.keys(defaultProfile)) {
    profile[key] = text(input[key]).slice(0, 10000);
} for (const key of ['avatar', 'resume'])
    if (profile[key] && !/^https?:\/\//i.test(profile[key]))
        throw new AppError(400, '头像与简历请使用公开的 http/https 地址'); await db.setting.upsert({ where: { key: 'profile' }, create: { key: 'profile', value: JSON.stringify(profile) }, update: { value: JSON.stringify(profile) } }); return profile; }
