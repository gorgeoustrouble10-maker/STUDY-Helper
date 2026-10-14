import Link from 'next/link';
import { ArrowUpRight, Sprout, Search, ArrowRight } from 'lucide-react';
import { getProfile } from '@/lib/store';
import { formatDate, type PublicContent, statusLabels } from '@/lib/types';
export async function PublicShell({ children }: {
    children: React.ReactNode;
}) { const profile = await getProfile(); return <div className="public-shell"><header className="public-header"><Link href="/" className="brand"><Sprout size={25}/><span>{profile.name}</span></Link><nav aria-label="公开导航">{[['关于', '/about'], ['作品', '/works'], ['文章', '/articles'], ['成长花园', '/garden'], ['推荐', '/recommendations'], ['连接', '/connect']].map(([name, url]) => <Link key={url} href={url}>{name}</Link>)}</nav><Link href="/search" aria-label="搜索" className="icon-button"><Search size={19}/></Link></header><main>{children}</main><footer className="public-footer"><div><Sprout size={20}/><span>{profile.name}<small>持续记录，慢慢生长。</small></span></div><nav><Link href="/topics">主题</Link><Link href="/archive">归档</Link><a href="/rss.xml">RSS</a><Link href="/workspace">工作台 <ArrowUpRight size={13}/></Link></nav><p>© {new Date().getFullYear()} · 每一页，都是生长的痕迹。</p></footer></div>; }
export function ContentCard({ item, large = false }: {
    item: PublicContent;
    large?: boolean;
}) { const kind = ({ work: '作品', article: '文章', garden: '成长笔记', recommendation: '推荐' } as Record<string, string>)[item.type]; return <Link className={`content-card ${large ? 'large' : ''}`} href={`/${({ work: 'works', article: 'articles', garden: 'garden', recommendation: 'recommendations' } as Record<string, string>)[item.type]}/${item.slug}`}><div className="eyebrow">{kind}<span>{formatDate(item.publishedAt)}</span></div><h3>{item.title}</h3><p>{item.summary || item.body.replace(/[#*`\[\]]/g, '').slice(0, 100)}</p><div className="card-bottom"><div className="tags">{item.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div><ArrowUpRight size={19}/></div>{item.type === 'garden' && <small>{String(item.details.maturity || '持续整理')}</small>}{item.type === 'recommendation' && <small>{String(item.details.recommendationType || '推荐')}</small>}</Link>; }
export function SectionTitle({ label, title, href }: {
    label: string;
    title: string;
    href?: string;
}) { return <div className="section-heading"><div><span className="eyebrow">{label}</span><h2>{title}</h2></div>{href && <Link href={href}>继续探索 <ArrowRight size={16}/></Link>}</div>; }
export function EmptyPublic({ text = '这里正在生长。内容整理好后，会出现在这里。' }: {
    text?: string;
}) { return <div className="empty-public"><Sprout size={34}/><p>{text}</p></div>; }
