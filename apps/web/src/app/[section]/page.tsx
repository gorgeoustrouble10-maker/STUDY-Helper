import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicShell, ContentCard, EmptyPublic } from '@/components/public';
import { getProfile, publicList } from '@/lib/store';
import { Markdown } from '@/components/markdown';
export const dynamic = 'force-dynamic';
const titles: Record<string, [
    string,
    string,
    string
]> = { works: ['WORK', '作品', '用具体成果，讲述我如何解决问题。'], articles: ['WRITING', '文章与观点', '观察、理解，以及自己的判断。'], garden: ['GARDEN', '成长花园', '一些尚在生长，也值得留下的理解。'], recommendations: ['COLLECTION', '我的推荐', '留下影响过我的事物，也写下推荐的理由。'], search: ['SEARCH', '寻找一段思考', '按关键词、主题和内容类型探索。'], topics: ['TOPICS', '主题与标签', '沿着一个主题，发现相连的内容。'], archive: ['ARCHIVE', '内容归档', '记录在时间里留下的痕迹。'] };
const types: Record<string, string> = { works: 'work', articles: 'article', garden: 'garden', recommendations: 'recommendation' };
export async function generateMetadata({ params }: {
    params: Promise<{
        section: string;
    }>;
}) { const { section } = await params; return { title: titles[section]?.[1] || ({ about: '关于我', connect: '连接' } as Record<string, string>)[section] || '数字花园' }; }
export default async function SectionPage({ params, searchParams }: {
    params: Promise<{
        section: string;
    }>;
    searchParams: Promise<Record<string, string | undefined>>;
}) {
    const { section } = await params;
    const query = await searchParams;
    const profile = await getProfile();
    if (section === 'about')
        return <PublicShell><div className="page-intro"><span className="eyebrow">ABOUT</span><h1>关于我</h1><p>{profile.tagline}</p></div><div className="about-layout"><aside className="profile-card"><div className="avatar">{profile.avatar ? <img src={profile.avatar} alt="头像"/> : profile.name.slice(0, 1)}</div><h2>{profile.name}</h2><p>{profile.introduction}</p>{profile.resume && <a className="button secondary" href={profile.resume} target="_blank" rel="noreferrer">查看简历</a>}</aside><div>{[['价值观', 'values'], ['技能与特长', 'skills'], ['兴趣与偏好', 'interests'], ['个人边界', 'boundaries'], ['成长脉络', 'timeline']].map(([title, key]) => <section className="about-section" key={key}><h2>{title}</h2><Markdown body={profile[key as keyof typeof profile]}/></section>)}</div></div></PublicShell>;
    if (section === 'connect')
        return <PublicShell><div className="page-intro"><span className="eyebrow">CONNECT</span><h1>从一次交流开始</h1><p>遇见相近的兴趣，也认识不同的视角。</p></div><div className="connect-grid"><section className="content-card"><h2>交流与合作</h2><Markdown body={profile.cooperation}/>{profile.email && <a className="button primary" href={`mailto:${profile.email}`}>写一封邮件</a>}</section><section className="content-card"><h2>朋友、社群与相关链接</h2><Markdown body={profile.links || '待填写：适合公开的朋友链接与社群介绍。'}/></section></div></PublicShell>;
    if (!titles[section])
        notFound();
    const [label, title, description] = titles[section];
    const all = await publicList();
    const tags = [...new Set(all.flatMap(x => x.tags))];
    let list = all.filter(x => (!types[section] || x.type === types[section]) && (!query.type || x.type === query.type) && (!query.tag || x.tags.includes(query.tag)) && (!query.category || x.details.recommendationType === query.category) && (!query.q || `${x.title} ${x.summary} ${x.body} ${x.tags.join(' ')}`.toLocaleLowerCase().includes(query.q.toLocaleLowerCase())));
    const total = list.length;
    const page = Math.max(1, Number(query.page) || 1);
    list = list.slice((page - 1) * 12, page * 12);
    return <PublicShell><div className="page-intro"><span className="eyebrow">{label}</span><h1>{title}</h1><p>{description}</p></div><form className="public-search"><input name="q" placeholder="搜索已公开的内容……" defaultValue={query.q}/><select name="tag" defaultValue={query.tag || ''}><option value="">全部主题</option>{tags.map(t => <option key={t}>{t}</option>)}</select>{section === 'recommendations' ? <select name="category" defaultValue={query.category || ''}><option value="">全部类型</option>{['网站', 'App', '书', '明星', '榜样人物'].map(t => <option key={t}>{t}</option>)}</select> : !types[section] && <select name="type" defaultValue={query.type || ''}><option value="">全部内容</option><option value="article">文章</option><option value="work">作品</option><option value="garden">花园</option><option value="recommendation">推荐</option></select>}<button className="button primary">查找</button></form>{section === 'topics' && <div className="topic-cloud">{tags.map(t => <Link key={t} href={`?tag=${encodeURIComponent(t)}`}>{t}<span>{all.filter(x => x.tags.includes(t)).length}</span></Link>)}</div>}{list.length ? <div className="content-grid section-list">{list.map(x => <ContentCard key={x.id} item={x}/>)}</div> : <EmptyPublic text={query.q ? '没有找到匹配内容，可以换一个关键词。' : undefined}/>}<div className="pagination"><span>共 {total} 条</span>{page > 1 && <Link href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(query).filter(([, v]) => v) as [
            string,
            string
        ][]), page: String(page - 1) })}`}>上一页</Link>}{page * 12 < total && <Link href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(query).filter(([, v]) => v) as [
            string,
            string
        ][]), page: String(page + 1) })}`}>下一页</Link>}</div></PublicShell>;
}
