import JSZip from 'jszip';
import { db, dataDir } from './db';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './store';
export const backupModels = ['record', 'domain', 'course', 'project', 'action', 'issue', 'resource', 'review', 'person', 'item', 'account', 'transaction', 'budget', 'channel', 'publication', 'publishedVersion', 'recordLink', 'tag', 'recordTag', 'attachment', 'publishedAsset', 'revision', 'setting'] as const;
export async function exportBackup(markdown = false) {
    const zip = new JSZip();
    const collections: Record<string, any[]> = await db.$transaction(async (tx) => { const result: Record<string, any[]> = {}; for (const model of backupModels)
        result[model] = await (tx as any)[model].findMany(); return result; });
    zip.file('manifest.json', JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), collections }, null, 2));
    for (const model of ['attachment', 'publishedAsset'])
        for (const file of collections[model]) {
            if (!/^(uploads|published)\/[a-zA-Z0-9-]+$/.test(file.storageKey))
                throw new AppError(400, '附件路径不正确');
            zip.file(`files/${file.storageKey}`, await readFile(path.join(dataDir, file.storageKey)));
        }
    if (markdown)
        for (const row of collections.record)
            zip.file(`markdown/${row.id}.md`, `# ${row.title}\n\n${row.body}\n`);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
export async function importBackup(buffer: Buffer) {
    if (buffer.length > 100 * 1024 * 1024)
        throw new AppError(400, '备份包过大');
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    const manifest = zip.file('manifest.json');
    if (!manifest)
        throw new AppError(400, '缺少备份清单');
    if (Object.keys(zip.files).length > 10000)
        throw new AppError(400, '备份文件数量过多');
    const raw = JSON.parse(await manifest.async('string'));
    if (raw.schemaVersion !== 1 || !raw.collections)
        throw new AppError(400, '备份格式不兼容');
    if (await db.record.count())
        throw new AppError(400, '仅可恢复到没有记录的新数据库');
    const collections = raw.collections as Record<string, any[]>;
    for (const model of backupModels)
        if (!Array.isArray(collections[model]) || collections[model].length > 100000)
            throw new AppError(400, `备份中的${model}无效`);
    const pending: {
        storageKey: string;
        bytes: Buffer;
    }[] = [];
    let total = 0;
    for (const model of ['attachment', 'publishedAsset'])
        for (const file of collections[model]) {
            if (!/^(uploads|published)\/[a-zA-Z0-9-]+$/.test(file.storageKey))
                throw new AppError(400, '备份附件路径不正确');
            const item = zip.file(`files/${file.storageKey}`);
            if (!item)
                throw new AppError(400, '备份缺少附件');
            const bytes = await item.async('nodebuffer');
            total += bytes.length;
            if (total > 250 * 1024 * 1024)
                throw new AppError(400, '解压后附件总量超过限制');
            pending.push({ storageKey: file.storageKey, bytes });
        }
    for (const name of Object.keys(zip.files))
        if (name.includes('..') || name.includes('\\') || name.startsWith('/'))
            throw new AppError(400, '备份包含不安全路径');
    await db.$transaction(async (tx) => { for (const model of backupModels)
        for (const data of collections[model])
            await (tx as any)[model].create({ data }); });
    for (const file of pending) {
        await mkdir(path.dirname(path.join(dataDir, file.storageKey)), { recursive: true });
        await writeFile(path.join(dataDir, file.storageKey), file.bytes);
    }
    return { records: collections.record.length, attachments: pending.length };
}
