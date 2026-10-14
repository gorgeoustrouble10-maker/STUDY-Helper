import { requireOwner, checkOrigin } from '@/lib/auth';
import { db, dataDir } from '@/lib/db';
import { ok, failure } from '@/lib/http';
import { AppError, getRecord, listRecords, createRecord, updateRecord, recordOperation, publish, withdraw, restoreRevision, restorePublished, snapshotReview, getProfile, saveProfile } from '@/lib/store';
import { exportBackup } from '@/lib/backup';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = {
    params: Promise<{
        path: string[];
    }>;
};
export async function GET(request: Request, context: Context) {
    try {
        await requireOwner();
        const parts = (await context.params).path;
        const params = new URL(request.url).searchParams;
        if (parts[0] === 'records' && !parts[1])
            return ok(await listRecords(params));
        if (parts[0] === 'records' && parts[1]) {
            const record = await getRecord(parts[1]);
            const [revisions, publishedVersions] = await Promise.all([db.revision.findMany({ where: { recordId: record.id }, select: { id: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 }), db.publishedVersion.findMany({ where: { publicationId: record.id }, select: { id: true, createdAt: true }, orderBy: { createdAt: 'desc' } })]);
            return ok({ ...record, revisions, publishedVersions });
        }
        if (parts[0] === 'profile')
            return ok(await getProfile());
        if (parts[0] === 'finance') {
            const transactions = await db.transaction.findMany({ where: { record: { deletedAt: null } } });
            const accounts = await db.account.findMany({ where: { record: { deletedAt: null } }, include: { record: true } });
            const budgets = await db.budget.findMany({ where: { record: { deletedAt: null } }, include: { record: true } });
            const localMonth = (date: Date) => date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7);
            const month = localMonth(new Date());
            const monthly = transactions.filter(t => localMonth(t.occurredAt) === month);
            return ok({ income: monthly.filter(t => t.direction === 'IN').reduce((n, t) => n + t.amountCents, 0), expense: monthly.filter(t => t.direction === 'OUT').reduce((n, t) => n + t.amountCents, 0), accounts: accounts.map(a => ({ id: a.recordId, title: a.record.title, balance: a.openingCents + transactions.filter(t => t.accountId === a.recordId).reduce((n, t) => n + t.amountCents * (t.direction === 'IN' ? 1 : -1), 0) })), budgets: budgets.map(b => ({ id: b.recordId, title: b.record.title, period: b.period, category: b.category, limit: b.limitCents, spent: transactions.filter(t => t.direction === 'OUT' && t.category === b.category && localMonth(t.occurredAt) === b.period).reduce((n, t) => n + t.amountCents, 0) })) });
        }
        if (parts[0] === 'tags')
            return ok(await db.tag.findMany({ orderBy: { name: 'asc' } }));
        if (parts[0] === 'filters')
            return ok(await db.setting.findMany({ where: { key: { startsWith: 'filter:' } } }));
        if (parts[0] === 'export') {
            const content = await exportBackup(params.get('format') === 'markdown');
            return new Response(new Uint8Array(content), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="garden-backup.zip"', 'Cache-Control': 'no-store' } });
        }
        if (parts[0] === 'files' && parts[1]) {
            const file = await db.attachment.findUnique({ where: { id: parts[1] }, include: { record: true } });
            if (!file || file.record.deletedAt)
                throw new AppError(404, '附件不存在');
            if (!/^uploads\/[a-zA-Z0-9-]+$/.test(file.storageKey))
                throw new AppError(404, '附件路径无效');
            return new Response(new Uint8Array(await readFile(path.join(dataDir, file.storageKey))), { headers: { 'Content-Type': file.mime, 'Content-Disposition': `${file.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
        }
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
        if (parts[0] === 'import') {
            const form = await request.formData();
            const file = form.get('file');
            if (!(file instanceof File) || file.size > 100 * 1024 * 1024)
                throw new AppError(400, '请选择不超过100MB的ZIP备份');
            const key = randomUUID(), incoming = path.join(dataDir, 'incoming');
            await mkdir(incoming, { recursive: true });
            const archive = path.join(incoming, `${key}.zip`);
            await writeFile(archive, Buffer.from(await file.arrayBuffer()));
            const target = path.join(dataDir, 'restored', key);
            const run = promisify(execFile);
            const result = await run(process.execPath, ['--import', 'tsx', path.resolve('scripts/restore.ts'), archive, target], { cwd: process.cwd(), env: process.env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
            const restored = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
            return ok({ ...restored, directory: `restored/${key}` });
        }
        if (parts[0] === 'files' && parts[1] === 'upload') {
            const form = await request.formData();
            const recordId = String(form.get('recordId') || '');
            const record = await getRecord(recordId);
            if (record.deletedAt)
                throw new AppError(400, '请先恢复记录');
            const file = form.get('file');
            if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024)
                throw new AppError(400, '请选择不超过10MB的附件');
            const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/markdown']);
            let mime = file.type;
            if (!allowed.has(mime)) {
                const extMime: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown' };
                const inferred = extMime[path.extname(file.name).toLowerCase()];
                if (inferred && (mime === '' || mime === 'application/octet-stream'))
                    mime = inferred;
            }
            if (!allowed.has(mime))
                throw new AppError(400, '支持 JPG、PNG、WebP、GIF、PDF 和纯文本（含 Markdown）');
            const bytes = Buffer.from(await file.arrayBuffer());
            if (mime === 'image/png' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
                throw new AppError(400, '图片内容与类型不匹配');
            if (mime === 'image/jpeg' && !(bytes[0] === 255 && bytes[1] === 216))
                throw new AppError(400, '图片内容与类型不匹配');
            if (mime === 'image/gif' && !['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString()))
                throw new AppError(400, '图片内容与类型不匹配');
            if (mime === 'image/webp' && !(bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'))
                throw new AppError(400, '图片内容与类型不匹配');
            if (mime === 'application/pdf' && bytes.subarray(0, 5).toString() !== '%PDF-')
                throw new AppError(400, 'PDF内容不正确');
            const id = randomUUID();
            const storageKey = `uploads/${id}`;
            await mkdir(path.join(dataDir, 'uploads'), { recursive: true });
            await writeFile(path.join(dataDir, storageKey), bytes);
            return ok(await db.attachment.create({ data: { id, recordId, name: file.name.replace(/[\r\n]/g, '').slice(0, 200), mime, size: file.size, storageKey } }), 201);
        }
        if (Number(request.headers.get('content-length')) > 2 * 1024 * 1024)
            throw new AppError(413, '内容过大');
        const body = await request.json();
        if (parts[0] === 'records' && !parts[1])
            return ok(await createRecord(body), 201);
        if (parts[0] === 'records' && parts[1] && !parts[2])
            return ok(await updateRecord(parts[1], body));
        if (parts[0] === 'records' && parts[1] && parts[2]) {
            const id = parts[1], operation = parts[2];
            if (!Number.isInteger(body.version) || body.version < 1)
                throw new AppError(400, '缺少有效版本');
            if (operation === 'publish')
                return ok(await publish(id, body.version));
            if (operation === 'withdraw')
                return ok(await withdraw(id, body.version));
            if (operation === 'revision')
                return ok(await restoreRevision(id, String(body.revisionId), body.version));
            if (operation === 'published-revision')
                return ok(await restorePublished(id, String(body.revisionId), body.version));
            if (operation === 'snapshot')
                return ok(await snapshotReview(id, body.version));
            return ok(await recordOperation(id, operation, body.version));
        }
        if (parts[0] === 'profile')
            return ok(await saveProfile(body));
        if (parts[0] === 'filters') {
            const name = String(body.name || '').trim().slice(0, 80);
            if (!name)
                throw new AppError(400, '请填写筛选名称');
            const value = JSON.stringify({ kind: String(body.kind || ''), q: String(body.q || '').slice(0, 200), status: String(body.status || '') });
            return ok(await db.setting.upsert({ where: { key: `filter:${name}` }, create: { key: `filter:${name}`, value }, update: { value } }));
        }
        if (parts[0] === 'tags' && parts[1] === 'rename') {
            const name = String(body.name || '').trim().slice(0, 60);
            if (!name)
                throw new AppError(400, '标签名称不能为空');
            return ok(await db.tag.update({ where: { id: String(body.id) }, data: { name, aliases: String(body.aliases || '').slice(0, 200) } }));
        }
        if (parts[0] === 'tags' && parts[1] === 'merge') {
            const source = String(body.source), target = String(body.target);
            if (source === target)
                throw new AppError(400, '请选择不同标签');
            return ok(await db.$transaction(async (tx) => { const a = await tx.tag.findUniqueOrThrow({ where: { id: source } }); const b = await tx.tag.findUniqueOrThrow({ where: { id: target } }); const links = await tx.recordTag.findMany({ where: { tagId: source } }); for (const link of links)
                await tx.recordTag.upsert({ where: { recordId_tagId: { recordId: link.recordId, tagId: target } }, create: { recordId: link.recordId, tagId: target }, update: {} }); await tx.tag.update({ where: { id: target }, data: { aliases: [b.aliases, a.name, a.aliases].filter(Boolean).join(',') } }); await tx.recordTag.deleteMany({ where: { tagId: source } }); await tx.tag.delete({ where: { id: source } }); return { merged: true }; }));
        }
        throw new AppError(404, '接口不存在');
    }
    catch (e) {
        return failure(e);
    }
}
