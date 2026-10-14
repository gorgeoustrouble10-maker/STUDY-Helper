import { currentOwner } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getRecord } from '@/lib/store';
import { Markdown } from '@/components/markdown';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export const metadata = { title: '公开稿预览', robots: { index: false, follow: false } };
export default async function Preview({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { if (!await currentOwner())
    redirect('/login'); const draft = await getRecord((await params).id); return <main className="preview-page"><div className="preview-notice">仅你可见的预览 · 当前内容尚未自动公开 <Link href={`/workspace/records/${draft.id}`}>返回编辑</Link></div><header className="article-header"><span className="eyebrow">{String(draft.fields.publicationType || 'article')}</span><h1>{draft.title}</h1><p>{String(draft.fields.summary || '')}</p><div className="tags">{draft.tags.map(t => <span key={t}>{t}</span>)}</div></header><article className="preview-article"><Markdown body={draft.body}/></article></main>; }
