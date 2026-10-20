import { db, dataDir } from '@/lib/db';
import { publicList, getProfile, AppError } from '@/lib/store';
import { ok, failure } from '@/lib/http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {
    params: Promise<{
        path?: string[];
    }>;
}) {
    try {
        const parts = (await context.params).path || [];
        if (parts[0] === 'profile')
            return ok(await getProfile());
        if (parts[0] === 'files' && parts[1] && parts[2]) {
            const version = await db.publishedVersion.findUnique({ where: { id: parts[1] }, include: { publication: { include: { record: true } } } });
            if (!version || version.publication.currentVersionId !== version.id || version.publication.record.deletedAt)
                throw new AppError(404, '附件不存在');
            const asset = await db.publishedAsset.findFirst({ where: { id: parts[2], versionId: version.id } });
            if (!asset || !/^published\/[a-zA-Z0-9-]+$/.test(asset.storageKey))
                throw new AppError(404, '附件不存在');
            return new Response(new Uint8Array(await readFile(path.join(dataDir, asset.storageKey))), { headers: { 'Content-Type': asset.mime, 'Content-Disposition': `${asset.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(asset.name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        }
        if (parts[0] === 'content') {
            const params = new URL(request.url).searchParams;
            const list = (await publicList()).filter(item => (!params.get('type') || item.type === params.get('type')) && (!params.get('q') || `${item.title} ${item.summary} ${item.body} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(params.get('q')!.toLocaleLowerCase())) && (!params.get('tag') || item.tags.includes(params.get('tag')!)));
            if (parts[1]) {
                const item = list.find(x => x.slug === parts[1]);
                if (!item)
                    throw new AppError(404, '内容不存在');
                return ok(item);
            }
            const page = Math.max(1, Number(params.get('page')) || 1), size = Math.min(100, Math.max(1, Number(params.get('size')) || 20));
            return ok({ list: list.slice((page - 1) * size, page * size), total: list.length, page, size, hasMore: page * size < list.length });
        }
        throw new AppError(404, '接口不存在');
    }
    catch (e) {
        return failure(e);
    }
}
