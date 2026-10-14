'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Sprout, Sun, Inbox, CheckSquare, FolderKanban, CircleHelp, Layers, BookOpen, RotateCcw, PenLine, Archive, Trash2, Settings, Plus, Search, ArrowUpRight, Menu, X, LogOut, ArrowRight, MoreHorizontal, Check, Download, Pin, Link2, Wallet, Users, Package, Calendar, Compass, LayoutGrid, List, FileText } from 'lucide-react';
import { api, markSigningOut } from '@/lib/client';
import { definitions, statusLabels, type Kind, type GardenRecord, formatDate } from '@/lib/types';
import { Editor } from './editor';
import { Markdown } from './markdown';
import { AiAssistant } from './ai-assistant';
type EditorState = {
    record?: GardenRecord;
    kind?: Kind;
    initialLinks?: {
        toId: string;
        relation: string;
    }[];
    initialBody?: string;
    initialTitle?: string;
};
const pages: Record<string, {
    title: string;
    description: string;
    kinds?: Kind[];
    create?: Kind;
}> = {
    today: { title: '今天，从一件重要的事开始。', description: '选好下一步，让事情慢慢向前。' }, inbox: { title: '收件箱', description: '先留下，再整理。', kinds: ['NOTE'], create: 'NOTE' }, actions: { title: '行动', description: '把想做的事情，落到可以执行的一步。', kinds: ['ACTION'], create: 'ACTION' }, projects: { title: '项目', description: '围绕成果组织行动，给每一段努力一个方向。', kinds: ['PROJECT'], create: 'PROJECT' }, issues: { title: '个人问题总表', description: '观察事实，保留假设，尝试改变。', kinds: ['ISSUE'], create: 'ISSUE' }, domains: { title: '生活领域', description: '看见生活的不同方面，持续照顾重要的事。', kinds: ['DOMAIN'], create: 'DOMAIN' }, courses: { title: '学习与课程', description: '课程、实验、资料与理解，共同积累。', kinds: ['COURSE'], create: 'COURSE' }, knowledge: { title: '知识与资源', description: '留下理解，也保留它的来源。', kinds: ['NOTE', 'RESOURCE'], create: 'NOTE' }, reviews: { title: '复盘', description: '对照预期与实际，把经历变成调整。', kinds: ['REVIEW'], create: 'REVIEW' }, writing: { title: '写作与发布', description: '从内部素材，整理出愿意与别人分享的表达。', kinds: ['PUBLICATION', 'CHANNEL'], create: 'PUBLICATION' }, people: { title: '人物与组织', description: '记住共同经历，也为下一次联系留个位置。', kinds: ['PERSON'], create: 'PERSON' }, items: { title: '物品与收纳', description: '物有所属，也更容易找到。', kinds: ['ITEM'], create: 'ITEM' }, finance: { title: '财务', description: '记录收支，理解每个周期的安排。', kinds: ['ACCOUNT', 'TRANSACTION', 'BUDGET'], create: 'TRANSACTION' }, archive: { title: '归档', description: '收起当前不需要的内容，保留它们的历史。' }, trash: { title: '回收站', description: '误删的记录，可以从这里恢复。' }, settings: { title: '设置与数据', description: '编辑个人信息，管理标签，保存完整的数据副本。' }
};
const nav = [{ label: '常用工作', items: [['today', '今日', Sun], ['inbox', '收件箱', Inbox], ['actions', '行动', CheckSquare], ['projects', '项目', FolderKanban], ['issues', '问题总表', CircleHelp]] }, { label: '生活与积累', items: [['domains', '生活领域', Layers], ['courses', '学习与课程', BookOpen], ['knowledge', '知识与资源', BookOpen], ['reviews', '复盘', RotateCcw], ['writing', '写作与发布', PenLine]] }, { label: '专门领域', items: [['people', '社会关系', Users], ['items', '物品与收纳', Package], ['finance', '财务', Wallet]] }, { label: '管理', items: [['archive', '归档', Archive], ['trash', '回收站', Trash2], ['settings', '设置与数据', Settings]] }] as const;
const money = (cents: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
export function Workbench({ route, username }: {
    route: string[];
    username: string;
}) {
    const page = route[0] || 'today', detailId = page === 'records' ? route[1] : undefined;
    const info = pages[page] || { title: '记录详情', description: '相关的行动、笔记和成果，都在这里。' };
    const [finance, setFinance] = useState<{
        income: number;
        expense: number;
        accounts: {
            id: string;
            title: string;
            balance: number;
        }[];
        budgets: {
            id: string;
            title: string;
            period: string;
            category: string;
            limit: number;
            spent: number;
        }[];
    } | null>(null);
    const [all, setAll] = useState<GardenRecord[]>([]), [archived, setArchived] = useState<GardenRecord[]>([]), [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [editor, setEditor] = useState<EditorState | null>(null), [mobile, setMobile] = useState(false), [q, setQ] = useState(''), [status, setStatus] = useState(''), [kindFilter, setKindFilter] = useState(''), [view, setView] = useState('list'), [tab, setTab] = useState('概览'), [detail, setDetail] = useState<GardenRecord | null>(null), [filters, setFilters] = useState<{
        key: string;
        value: string;
    }[]>([]), [pinned, setPinned] = useState<string[]>([]), [profile, setProfile] = useState<Record<string, string>>({}), [tagList, setTagList] = useState<{
        id: string;
        name: string;
        aliases: string;
    }[]>([]), [tagSource, setTagSource] = useState(''), [tagTarget, setTagTarget] = useState(''), [pageNumber, setPageNumber] = useState(1);
    async function refresh() { setError(''); try {
        let records: GardenRecord[] = [];
        let index = 1;
        while (true) {
            const data = await api<{
                list: GardenRecord[];
                hasMore: boolean;
            }>(`records?size=200&page=${index}`);
            records.push(...data.list);
            if (!data.hasMore)
                break;
            index++;
        }
        setAll(records);
        if (page === 'archive' || page === 'trash') {
            let rows: GardenRecord[] = [];
            let p = 1;
            while (true) {
                const data = await api<{
                    list: GardenRecord[];
                    hasMore: boolean;
                }>(`records?view=${page}&size=200&page=${p}`);
                rows.push(...data.list);
                if (!data.hasMore)
                    break;
                p++;
            }
            setArchived(rows);
        }
        if (detailId)
            setDetail(await api<GardenRecord>(`records/${detailId}`));
        setFilters(await api('filters'));
        setTagList(await api('tags'));
        if (page === 'finance')
            setFinance(await api('finance'));
        if (page === 'settings') {
            setProfile(await api('profile'));
            setTagList(await api('tags'));
        }
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    useEffect(() => { setBusy(true); setQ(''); setStatus(''); setKindFilter(''); setPageNumber(1); setTab('概览'); void refresh(); try {
        setPinned(JSON.parse(localStorage.getItem('garden-pins') || '[]'));
    }
    catch {
        setPinned([]);
    } }, [page, detailId]);
    useEffect(() => setPageNumber(1), [q, status, kindFilter]);
    async function edit(r: GardenRecord) { try {
        setEditor({ record: await api(`records/${r.id}`) });
    }
    catch (e) {
        setError((e as Error).message);
    } }
    async function operation(r: GardenRecord, op: string) { try {
        await api(`records/${r.id}/${op}`, { version: r.version });
        setNotice(op === 'delete' ? '记录已移入回收站' : '已更新');
        await refresh();
    }
    catch (e) {
        setError((e as Error).message);
    } }
    const newRecord = (kind: Kind, links?: {
        toId: string;
        relation: string;
    }[]) => setEditor({ kind, initialLinks: links });
    const draftFrom = (r: GardenRecord) => setEditor({ kind: 'PUBLICATION', initialTitle: r.title, initialBody: r.body, initialLinks: [{ toId: r.id, relation: 'source' }] });
    const actionable = all.filter(x => x.kind === 'ACTION' && x.status !== 'DONE');
    const currentRows = (page === 'archive' || page === 'trash' ? archived : all).filter(r => (!info.kinds || info.kinds.includes(r.kind)) && (page !== 'inbox' || r.status === 'INBOX') && (!q || `${r.title} ${r.body} ${Object.values(r.fields).filter(v => typeof v === 'string').join(' ')} ${r.tags.join(' ')} ${tagList.filter(t => r.tags.includes(t.name)).map(t => t.aliases).join(' ')}`.toLocaleLowerCase().includes(q.toLocaleLowerCase())) && (!status || r.status === status) && (!kindFilter || r.kind === kindFilter));
    const rows = currentRows.slice((pageNumber - 1) * 24, pageNumber * 24);
    function togglePin(id: string) { const next = pinned.includes(id) ? pinned.filter(x => x !== id) : [...pinned, id]; setPinned(next); localStorage.setItem('garden-pins', JSON.stringify(next)); }
    function rowCard(r: GardenRecord) { return <article className="record-card" key={r.id}><div className="record-card-top"><span className={`status-badge status-${r.status.toLowerCase()}`}>{statusLabels[r.status] || r.status}</span><span className="record-kind">{definitions[r.kind].label}</span><button className="icon-button small" aria-label="固定记录" onClick={() => togglePin(r.id)}><Pin size={14} fill={pinned.includes(r.id) ? 'currentColor' : 'none'}/></button></div><Link href={`/workspace/records/${r.id}`}><h3>{r.title}</h3></Link><p>{r.kind === 'PROJECT' ? String(r.fields.nextStep || r.fields.outcome || '填写阶段成果与下一步') : r.kind === 'ACTION' ? String(r.fields.blocker || r.body || '为这一步留出时间') : r.kind === 'ITEM' ? `${r.fields.location || '位置待填写'} · ${r.fields.quantity ?? 1} 件` : r.kind === 'TRANSACTION' ? `${statusLabels[String(r.fields.direction)]} ${money(Number(r.fields.amountCents || 0))} · ${r.fields.category || '其他'}` : r.kind === 'BUDGET' ? `${r.fields.period} · ${r.fields.category} · ${money(Number(r.fields.limitCents || 0))}` : r.body.replace(/[#*`]/g, '').slice(0, 100) || '留下一段记录，再让它慢慢完整。'}</p><div className="tags">{r.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div>{r.kind === 'ACTION' && <div className="record-dates">{Boolean(r.fields.plannedAt) && <span>计划 {formatDate(r.fields.plannedAt)}</span>}{Boolean(r.fields.dueAt) && <span>截止 {formatDate(r.fields.dueAt)}</span>}</div>}<div className="record-actions"><button onClick={() => edit(r)}>编辑</button>{page === 'trash' ? <button onClick={() => operation(r, 'restore')}>恢复</button> : <>{r.kind === 'ACTION' && <button onClick={() => operation(r, r.status === 'DONE' ? 'reopen' : 'complete')}>{r.status === 'DONE' ? '重新打开' : '完成'}</button>}<details className="action-menu"><summary aria-label="更多操作"><MoreHorizontal size={18}/></summary><div><button onClick={() => draftFrom(r)}>整理公开稿</button><button onClick={() => newRecord('ACTION', [{ toId: r.id, relation: 'related' }])}>建立关联行动</button><button onClick={() => operation(r, page === 'archive' ? 'unarchive' : 'archive')}>{page === 'archive' ? '移出归档' : '归档'}</button><button onClick={() => operation(r, 'delete')}>移入回收站</button></div></details></>}</div></article>; }
    function today() { const focus = actionable.filter(r => r.fields.todayFocus); const waiting = actionable.filter(r => ['WAITING', 'BLOCKED'].includes(r.status)); const scheduled = actionable.filter(r => r.fields.plannedAt || r.fields.dueAt || r.fields.remindAt).sort((a, b) => String(a.fields.dueAt || a.fields.plannedAt).localeCompare(String(b.fields.dueAt || b.fields.plannedAt))).slice(0, 5); const commitments = all.filter(r => r.kind === 'PROJECT' && r.fields.weeklyCommitment); const inboxCount = all.filter(r => r.kind === 'NOTE' && r.status === 'INBOX').length; const review = all.find(r => r.kind === 'REVIEW'); return <><div className="today-summary"><div><span className="eyebrow">{new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' })}</span><h2>留一点空间，做重要的事。</h2><p>今天的安排由你决定。先选一件能向前推进的小事。</p><button className="button primary" onClick={() => newRecord('ACTION')}><Plus size={17}/>安排一个行动</button></div><div className="today-stat"><Sun size={34}/><strong>{focus.length}</strong><span>今日重点</span><Link href="/workspace/inbox">{inboxCount} 条记录待整理 <ArrowRight size={13}/></Link></div></div><div className="workspace-section-heading"><h2>今日重点</h2><Link href="/workspace/actions">查看全部行动 →</Link></div>{focus.length ? <div className="records-grid">{focus.map(rowCard)}</div> : <div className="empty-state"><Sun size={27}/><h3>还没有选定今日重点</h3><p>在行动的编辑页勾选“今日重点”，从一至三项开始。</p><button onClick={() => newRecord('ACTION')} className="button secondary">新增行动</button></div>}<div className="dashboard-grid"><section className="dashboard-panel"><h2>安排与截止日期</h2>{scheduled.length ? scheduled.map(r => <Link className="compact-row" key={r.id} href={`/workspace/records/${r.id}`}><span>{r.title}</span><small>{r.fields.dueAt ? '截止' : '计划'} {formatDate(r.fields.dueAt || r.fields.plannedAt || r.fields.remindAt)}</small></Link>) : <p className="muted">安排好时间的行动会出现在这里。</p>}</section><section className="dashboard-panel"><h2>本周承诺</h2>{commitments.length ? commitments.map(r => <Link className="compact-row" key={r.id} href={`/workspace/records/${r.id}`}><span>{r.title}</span><small>{String(r.fields.outcome || '阶段成果待填写')}</small></Link>) : <p className="muted">在项目里选择“本周承诺”，为成果留出空间。</p>}</section><section className="dashboard-panel"><h2>阻塞与等待</h2>{waiting.length ? waiting.map(r => <Link className="compact-row" key={r.id} href={`/workspace/records/${r.id}`}><span>{r.title}</span><small>{String(r.fields.blocker || '补充等待条件')}</small></Link>) : <p className="muted">目前没有记录中的阻塞事项。</p>}</section><section className="dashboard-panel"><h2>最近的复盘调整</h2>{review ? <><Link href={`/workspace/records/${review.id}`}>{review.title}</Link><p>{String(review.fields.adjustment || '写下继续、改变和暂停的事情。')}</p></> : <p className="muted">复盘留下的调整，会帮助你重新安排下一步。</p>}<button className="text-button" onClick={() => newRecord('REVIEW')}>开始一次复盘 →</button></section></div><div className="workspace-section-heading"><h2>继续上次的记录</h2></div><div className="records-grid">{all.slice(0, 3).map(rowCard)}</div></>; }
    function details() {
        if (!detail)
            return null;
        const related = all.filter(r => detail.links.some(l => l.toId === r.id) || detail.backlinks.some(l => l.fromId === r.id));
        const tabs = detail.kind === 'PROJECT' ? ['概览', '行动', '里程碑', '资料', '问题与决定', '复盘与成果'] : detail.kind === 'COURSE' ? ['概览', '章节', '实验与作业', '笔记与资料', '问题', '阶段总结'] : detail.kind === 'DOMAIN' ? ['概览', '项目与课程', '行动', '问题', '笔记与资料', '复盘'] : ['概览', '关联记录'];
        let linked = related;
        if (tab === '行动')
            linked = related.filter(r => r.kind === 'ACTION');
        if (tab === '项目与课程')
            linked = related.filter(r => ['PROJECT', 'COURSE'].includes(r.kind));
        if (tab === '资料' || tab === '笔记与资料' || tab === '章节')
            linked = related.filter(r => ['NOTE', 'RESOURCE'].includes(r.kind));
        if (tab === '实验与作业')
            linked = related.filter(r => ['ACTION', 'PROJECT'].includes(r.kind) || detail.links.some(l => l.toId === r.id && l.relation === 'assignment'));
        if (tab === '问题' || tab === '问题与决定')
            linked = related.filter(r => r.kind === 'ISSUE');
        if (['复盘与成果', '复盘', '阶段总结'].includes(tab))
            linked = related.filter(r => ['REVIEW', 'PUBLICATION'].includes(r.kind));
        return <><div className="detail-title"><div><span className="eyebrow">{definitions[detail.kind].label} / {statusLabels[detail.status]}</span><h1>{detail.title}</h1></div><div className="toolbar"><button className="button secondary" onClick={() => edit(detail)}>编辑记录</button><button className="button primary" onClick={() => draftFrom(detail)}>整理公开稿</button></div></div>{detail.deletedAt && <div className="notice">这条记录在回收站中。<button onClick={() => operation(detail, 'restore')}>恢复记录</button></div>}<div className="tabs">{tabs.map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>{tab === '概览' || tab === '里程碑' ? <div className="detail-overview"><section className="dashboard-panel"><Markdown body={detail.body || '这段记录还没有正文。可以点击编辑，补充观察与过程。'}/><dl className="detail-fields">{definitions[detail.kind].fields.map(f => { const value = detail.fields[f.key]; if (!value)
            return null; return <div key={f.key}><dt>{f.label}</dt><dd>{f.type === 'date' ? formatDate(value) : f.type === 'money' ? money(Number(value)) : f.type === 'checkbox' ? '是' : statusLabels[String(value)] || String(value)}</dd></div>; })}</dl>{detail.kind === 'REVIEW' && Boolean(detail.fields.snapshots) && <details><summary>当时的证据快照</summary><pre className="snapshot-pre">{JSON.stringify(JSON.parse(String(detail.fields.snapshots)), null, 2)}</pre></details>}{detail.attachments.map(a => <a className="attachment-link" key={a.id} href={`/api/workspace/files/${a.id}`}>{a.name} ↗</a>)}</section><aside className="dashboard-panel"><h3>关联与下一步</h3><div className="quick-create">{(['ACTION', 'NOTE', 'ISSUE', 'RESOURCE', 'REVIEW'] as Kind[]).map(k => <button key={k} onClick={() => newRecord(k, [{ toId: detail.id, relation: k === 'ACTION' ? 'action' : 'related' }])}><Plus size={14}/>{definitions[k].label}</button>)}</div>{related.map(r => <Link className="compact-row" key={r.id} href={`/workspace/records/${r.id}`}><span>{r.title}</span><small>{definitions[r.kind].label}</small></Link>)}</aside></div> : <><div className="toolbar section-tools"><button className="button secondary" onClick={() => newRecord(tab === '行动' || tab === '实验与作业' ? 'ACTION' : tab.includes('问题') ? 'ISSUE' : tab.includes('复盘') || tab === '阶段总结' ? 'REVIEW' : 'NOTE', [{ toId: detail.id, relation: tab === '实验与作业' ? 'assignment' : tab === '章节' ? 'chapter' : 'related' }])}><Plus size={16}/>添加关联记录</button></div>{linked.length ? <div className="records-grid">{linked.map(rowCard)}</div> : <div className="empty-state"><Link2 size={26}/><p>这里尚没有关联记录，添加后会同时出现在对应的全局入口。</p></div>}</>}{detail.kind === 'DOMAIN' && ['财务', '收纳', '社会关系', '学习', '写作', '自媒体'].includes(detail.title) && <div className="domain-entry"><Link className="button secondary" href={`/workspace/${({ 财务: 'finance', 收纳: 'items', 社会关系: 'people', 学习: 'courses', 写作: 'writing', 自媒体: 'writing' } as Record<string, string>)[detail.title]}`}>进入专门管理 <ArrowRight size={15}/></Link></div>}</>;
    }
    function financeSummary() { if (!finance)
        return null; return <><div className="finance-summary"><div><span>本月收入</span><strong>{money(finance.income)}</strong></div><div><span>本月支出</span><strong>{money(finance.expense)}</strong></div><div><span>本月结余</span><strong>{money(finance.income - finance.expense)}</strong></div></div><div className="dashboard-grid">{finance.accounts.map(a => <div className="dashboard-panel" key={a.id}><h3>{a.title}</h3><strong>{money(a.balance)}</strong><button className="text-button" onClick={async () => setEditor({ record: await api('records/' + a.id) })}>编辑账户</button></div>)}{finance.budgets.map(b => <div className="dashboard-panel" key={b.id}><h3>{b.title}</h3><p>{b.period} · {b.category}</p><strong>{money(b.spent)} / {money(b.limit)}</strong><p className={b.spent > b.limit ? 'error-message' : 'muted'}>剩余 {money(b.limit - b.spent)}</p></div>)}</div></>; }
    function settings() { return <div className="settings-layout"><form className="dashboard-panel" onSubmit={async (e) => { e.preventDefault(); try {
        await api('profile', profile);
        setNotice('公开个人信息已更新');
    }
    catch (e) {
        setError((e as Error).message);
    } }}><h2>公开个人信息</h2><p className="muted">这里的字段会直接用于公开首页、关于和连接页面。</p><div className="field-grid">{Object.entries({ name: '名称', tagline: '一句话介绍', introduction: '个人介绍', values: '价值观', skills: '技能与特长', interests: '兴趣与偏好', boundaries: '个人边界', timeline: '成长脉络', now: '此刻状态', email: '公开邮箱', links: '朋友与社群链接（Markdown）', cooperation: '交流与合作', avatar: '公开头像地址', resume: '公开简历地址' }).map(([key, label]) => <label key={key}>{label}{['name', 'tagline', 'email', 'avatar', 'resume'].includes(key) ? <input value={profile[key] || ''} onChange={e => setProfile({ ...profile, [key]: e.target.value })}/> : <textarea rows={3} value={profile[key] || ''} onChange={e => setProfile({ ...profile, [key]: e.target.value })}/>}</label>)}</div><button className="button primary">保存个人信息</button></form><section className="dashboard-panel"><h2>数据自主</h2><p>完整导出包含正文、附件、关联和发布版本，不包含账号密码与会话。</p><a className="button secondary" href="/api/workspace/export"><Download size={16}/>完整备份</a><a className="button secondary" href="/api/workspace/export?format=markdown"><Download size={16}/>备份与 Markdown</a><p className="muted">恢复命令：npm run restore -- 备份文件 新目录。恢复使用空目录，不覆盖当前数据。</p><h3>验证备份恢复</h3><label>选择导出的 ZIP 备份<input type="file" accept=".zip" onChange={async (e) => { const file = e.target.files?.[0]; if (!file)
        return; setNotice('正在验证恢复……'); try {
        const form = new FormData();
        form.set('file', file);
        const response = await fetch('/api/workspace/import', { method: 'POST', body: form });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error.message);
        setNotice(`恢复验证成功。副本保存在 ${result.data.directory}，当前数据保持可用。`);
    }
    catch (e) {
        setError((e as Error).message);
    } }}/></label></section><section className="dashboard-panel"><h2>标签与别名</h2>{tagList.map(t => <form key={t.id} className="tag-edit" onSubmit={async (e) => { e.preventDefault(); const form = new FormData(e.currentTarget); try {
        await api('tags/rename', { id: t.id, name: form.get('name'), aliases: form.get('aliases') });
        await refresh();
        setNotice('标签已更新');
    }
    catch (e) {
        setError((e as Error).message);
    } }}><input aria-label="标签名称" name="name" defaultValue={t.name}/><input aria-label="标签别名" name="aliases" defaultValue={t.aliases} placeholder="别名，逗号分隔"/><button className="button secondary">保存</button></form>)}<div className="add-link-row"><select aria-label="源标签" value={tagSource} onChange={e => setTagSource(e.target.value)}><option value="">待合并标签</option>{tagList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><select aria-label="目标标签" value={tagTarget} onChange={e => setTagTarget(e.target.value)}><option value="">合并到</option>{tagList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><button className="button secondary" disabled={!tagSource || !tagTarget} onClick={async () => { try {
        await api('tags/merge', { source: tagSource, target: tagTarget });
        await refresh();
        setNotice('标签已合并');
    }
    catch (e) {
        setError((e as Error).message);
    } }}>合并</button></div></section></div>; }
    return <div className="workspace-shell"><aside className={`workspace-sidebar ${mobile ? 'open' : ''}`}><Link href="/" className="brand"><Sprout size={24}/>数字花园<small>个人工作台</small></Link><button className="button quick-capture" onClick={() => newRecord('NOTE')}><Plus size={17}/>快速记录</button><nav aria-label="工作台导航">{nav.map(group => <div className="nav-group" key={group.label}><span>{group.label}</span>{group.items.map(([key, label, Icon]) => <Link key={key} className={page === key ? 'active' : ''} href={key === 'today' ? '/workspace' : `/workspace/${key}`} onClick={() => setMobile(false)}><Icon size={17}/>{label}{key === 'inbox' && <small>{all.filter(r => r.kind === 'NOTE' && r.status === 'INBOX').length}</small>}</Link>)}</div>)}{pinned.length > 0 && <div className="nav-group"><span>固定入口</span>{all.filter(r => pinned.includes(r.id)).map(r => <Link key={r.id} href={`/workspace/records/${r.id}`}><Pin size={14}/>{r.title}</Link>)}</div>}</nav><div className="sidebar-bottom"><span><span className="owner-avatar">{username.slice(0, 1).toUpperCase()}</span>{username}</span><button className="icon-button" aria-label="退出登录" onClick={async () => { markSigningOut(); await fetch('/api/auth/logout', { method: 'POST' }); window.location.assign('/'); }}><LogOut size={16}/></button></div></aside>{mobile && <button className="sidebar-overlay" aria-label="关闭导航" onClick={() => setMobile(false)}/>}
    <div className="workspace-main"><header className="workspace-topbar"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setMobile(true)}><Menu size={22}/></button><span>工作台 <span className="muted">/ {page === 'records' ? '记录' : info.title.replace(/。/g, '')}</span></span><div><Link href="/" target="_blank">查看公开花园 <ArrowUpRight size={15}/></Link><span className="private-indicator">仅自己可见</span></div></header><main className="workspace-content">{page !== 'records' && <div className="workspace-title"><div><span className="eyebrow">YOUR PERSONAL SPACE</span><h1>{info.title}</h1><p>{info.description}</p></div>{info.create && <button className="button primary" onClick={() => newRecord(info.create!)}><Plus size={17}/>新增{definitions[info.create].label}</button>}</div>}{notice && <div className="notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}{error && <div className="error-message" role="alert">{error}<button onClick={() => refresh()}>重试</button></div>}
    {busy ? <div className="loading-state"><Sprout size={26}/><p>正在取回你的记录……</p></div> : page === 'today' ? today() : page === 'records' ? details() : page === 'settings' ? settings() : <>{page === 'finance' && financeSummary()}<div className="list-toolbar"><label className="search-input"><Search size={17}/><input aria-label="搜索记录" placeholder="搜索标题、正文或标签" value={q} onChange={e => setQ(e.target.value)}/></label><select aria-label="状态筛选" value={status} onChange={e => setStatus(e.target.value)}><option value="">全部状态</option>{[...new Set((info.kinds || Object.keys(definitions) as Kind[]).flatMap(k => definitions[k].statuses))].map(s => <option key={s} value={s}>{statusLabels[s]}</option>)}</select>{(!info.kinds || info.kinds.length > 1) && <select aria-label="类型筛选" value={kindFilter} onChange={e => setKindFilter(e.target.value)}><option value="">全部类型</option>{(info.kinds || Object.keys(definitions) as Kind[]).map(k => <option key={k} value={k}>{definitions[k].label}</option>)}</select>}<button className="button secondary" onClick={async () => { const name = window.prompt('给这个筛选起一个名字'); if (name) {
        await api('filters', { name, q, status, kind: kindFilter });
        await refresh();
    } }}>保存筛选</button>{page === 'actions' && <div className="view-switch"><button className={view === 'list' ? 'selected' : ''} aria-label="列表视图" onClick={() => setView('list')}><List size={17}/></button><button className={view === 'board' ? 'selected' : ''} aria-label="看板视图" onClick={() => setView('board')}><LayoutGrid size={17}/></button><button className={view === 'quadrants' ? 'selected' : ''} onClick={() => setView('quadrants')}>四象限</button></div>}</div>{filters.length > 0 && <div className="saved-filters">{filters.map(f => <button key={f.key} onClick={() => { const v = JSON.parse(f.value); setQ(v.q); setStatus(v.status); setKindFilter(v.kind); }}>{f.key.slice(7)}</button>)}</div>}{info.kinds && info.kinds.length > 1 && <div className="toolbar section-tools">{info.kinds.map(k => <button className="button secondary" key={k} onClick={() => newRecord(k)}><Plus size={14}/>{definitions[k].label}</button>)}</div>}{page === 'domains' && <div className="domain-groups">{['个人成长', '生活与复盘'].map(group => <section key={group}><h2>{group}</h2><div className="records-grid">{currentRows.filter(r => r.fields.group === group).map(rowCard)}</div></section>)}</div>}{page !== 'domains' && (view === 'board' && page === 'actions' ? <div className="kanban-board">{definitions.ACTION.statuses.map(s => <section key={s}><h3>{statusLabels[s]} <small>{currentRows.filter(x => x.status === s).length}</small></h3>{currentRows.filter(x => x.status === s).map(rowCard)}</section>)}</div> : view === 'quadrants' && page === 'actions' ? <div className="quadrants">{[[true, true, '重要且紧急'], [true, false, '重要不紧急'], [false, true, '紧急不重要'], [false, false, '不紧急不重要']].map(([important, urgent, label]) => <section key={String(label)}><h3>{label}</h3>{currentRows.filter(x => x.fields.important === important && x.fields.urgent === urgent).map(rowCard)}</section>)}<section><h3>尚未判断</h3>{currentRows.filter(x => x.fields.important === null || x.fields.urgent === null).map(rowCard)}</section></div> : rows.length ? <div className="records-grid">{rows.map(rowCard)}</div> : <div className="empty-state"><Sprout size={30}/><h3>{q || status ? '没有找到匹配的记录' : '这里还留着一些空间'}</h3><p>从一段记录开始，再慢慢补充结构。</p>{info.create && <button className="button secondary" onClick={() => newRecord(info.create!)}>新增{definitions[info.create].label}</button>}</div>)}{page !== 'domains' && view === 'list' && <div className="pagination"><span>共 {currentRows.length} 条</span>{pageNumber > 1 && <button onClick={() => setPageNumber(pageNumber - 1)}>上一页</button>}{pageNumber * 24 < currentRows.length && <button onClick={() => setPageNumber(pageNumber + 1)}>下一页</button>}</div>}</>}
    </main></div><nav className="mobile-bottom"><Link href="/workspace"><Sun size={18}/>今日</Link><Link href="/workspace/actions"><CheckSquare size={18}/>行动</Link><button onClick={() => newRecord('NOTE')}><Plus size={23}/>记录</button><Link href="/workspace/domains"><Layers size={18}/>领域</Link><button onClick={() => setMobile(true)}><Menu size={18}/>更多</button></nav><AiAssistant currentRecordId={detailId} onDataChanged={() => { void refresh(); }}/>{editor && <Editor key={editor.record?.id || `${editor.kind}:${editor.initialLinks?.[0]?.toId || ''}`} {...editor} all={all} onClose={() => setEditor(null)} onSaved={() => { void refresh(); }}/>}</div>;
}
function localMonth(value: unknown) { return value ? new Date(String(value)).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7) : ''; }
