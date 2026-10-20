import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PublicShell, ContentCard } from '@/components/public';
import { publicList } from '@/lib/store';
import { formatDate, statusLabels } from '@/lib/types';
import { Markdown } from '@/components/markdown';
export const dynamic = 'force-dynamic';
const types: Record<string, string> = { works: 'work', articles: 'article', garden: 'garden', recommendations: 'recommendation' };
export async function generateMetadata({ params }: {
    params: Promise<{
        section: string;
        slug: string;
    }>;
}) { const { section, slug } = await params; const item = (await publicList()).find(x => x.slug === slug && x.type === types[section]); return { title: item?.title || '内容不存在', description: item?.summary, openGraph: { title: item?.title, description: item?.summary, type: 'article' } }; }
export default async function ContentPage({ params }: {
    params: Promise<{
        section: string;
        slug: string;
    }>;
}) { const { section, slug } = await params; const all = await publicList(); const item = all.find(x => x.slug === slug && x.type === types[section]); if (!item)
    notFound(); const related = all.filter(x => x.id !== item.id && x.tags.some(t => item.tags.includes(t))).slice(0, 3); const headings = item.body.split('\n').filter(x => x.startsWith('## ')).map(x => x.slice(3)); return <PublicShell><div className="article-header"><Link href={`/${section}`} className="eyebrow">← {statusLabels[item.type]}</Link><h1>{item.title}</h1><p>{item.summary}</p><div className="article-meta"><span>发布于 {formatDate(item.publishedAt)}</span>{item.type === 'garden' && <span>{String(item.details.maturity || '持续整理')}</span>}{item.tags.map(t => <Link key={t} href={`/topics?tag=${encodeURIComponent(t)}`}>#{t}</Link>)}</div></div><div className="article-layout"><article><Markdown body={item.body}/>{Object.entries(item.details).filter(([k, v]) => v && ['audience', 'role', 'limitations'].includes(k)).map(([k, v]) => <section key={k} className="detail-callout"><h3>{{ audience: '适用场景', role: '我的角色', limitations: '局限' }[k]}</h3><Markdown body={String(v)}/></section>)}{item.assets.length > 0 && <section className="detail-callout"><h3>附件与成果</h3>{item.assets.map(a => <a key={a.id} href={a.url} className="attachment-link">{a.name} ↗</a>)}</section>}</article>{headings.length > 0 && <aside className="article-toc"><p className="eyebrow">本页内容</p>{headings.map((h, i) => <a key={i} href={`#${h.replace(/\s/g, '-')}`}>{h}</a>)}</aside>}</div>{related.length > 0 && <section className="public-section"><h2>沿着这条线继续读</h2><div className="content-grid">{related.map(x => <ContentCard key={x.id} item={x}/>)}</div></section>}</PublicShell>; }
