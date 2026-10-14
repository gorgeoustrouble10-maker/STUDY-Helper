'use client';
import { useEffect, useRef, useState } from 'react';
import { X, Save, Eye, Link2, Upload, History, Check, Plus, FileText } from 'lucide-react';
import { definitions, statusLabels, type Kind, type GardenRecord, type Field, formatDate } from '@/lib/types';
import { api, ClientError } from '@/lib/client';
import { Markdown } from './markdown';
type LinkValue = {
    toId: string;
    relation: string;
};
const localDate = (value: unknown) => value ? new Date(String(value)).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T').slice(0, 16) : '';
export function Editor({ record, kind = 'NOTE', all, onClose, onSaved, initialLinks = [], initialBody = '', initialTitle = '' }: {
    record?: GardenRecord;
    kind?: Kind;
    all: GardenRecord[];
    onClose: () => void;
    onSaved: (r: GardenRecord) => void;
    initialLinks?: LinkValue[];
    initialBody?: string;
    initialTitle?: string;
}) {
    const currentKind = record?.kind || kind;
    const definition = definitions[currentKind];
    const [id, setId] = useState(record?.id), [version, setVersion] = useState(record?.version), [title, setTitle] = useState(record?.title || initialTitle), [body, setBody] = useState(record?.body || initialBody), [status, setStatus] = useState(record?.status || definition.statuses[0]);
    const [fields, setFields] = useState<Record<string, unknown>>(record?.fields || {}), [tags, setTags] = useState(record?.tags.join(', ') || ''), [links, setLinks] = useState<LinkValue[]>(record?.links.map(l => ({ toId: l.toId, relation: l.relation })) || initialLinks);
    const [attachments, setAttachments] = useState(record?.attachments || []), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [preview, setPreview] = useState(false), [history, setHistory] = useState(false), [conflict, setConflict] = useState<GardenRecord | null>(null), [recovered, setRecovered] = useState(false), [addTarget, setAddTarget] = useState(''), [relation, setRelation] = useState('related');
    const changed = useRef(false), saving = useRef(false), bodyRef = useRef<HTMLTextAreaElement>(null), revisionList = useRef(record?.revisions || []), localKey = useRef(`garden-draft:${record?.id || 'new:' + kind}`);
    const [renderVersion, setRenderVersion] = useState(0);
    const payload = () => ({ kind: currentKind, title, body, status, version, fields, tags: tags.split(/[,，]/).map(x => x.trim()).filter(Boolean), links });
    const touch = () => { changed.current = true; setMessage('待保存'); setError(''); };
    useEffect(() => { const saved = localStorage.getItem(localKey.current); if (saved) {
        try {
            const draft = JSON.parse(saved);
            if (draft.savedAt > new Date(record?.updatedAt || 0).getTime()) {
                setTitle(draft.title);
                setBody(draft.body);
                setStatus(draft.status);
                setFields(draft.fields);
                setTags(draft.tags.join(', '));
                setLinks(draft.links);
                setVersion(draft.version || record?.version);
                setRecovered(true);
                changed.current = true;
            }
        }
        catch { }
    } }, []);
    useEffect(() => { if (!changed.current)
        return; localStorage.setItem(localKey.current, JSON.stringify({ ...payload(), savedAt: Date.now() })); if (id && !conflict) {
        const timer = setTimeout(() => { void save(true); }, 1600);
        return () => clearTimeout(timer);
    } }, [title, body, status, fields, tags, links, id, conflict]);
    async function save(automatic = false) {
        if (saving.current || (!title.trim() && automatic))
            return null;
        saving.current = true;
        setBusy(true);
        setError('');
        setMessage(automatic ? '正在自动保存……' : '正在保存……');
        const sent = payload();
        try {
            const saved = await api<GardenRecord>(id ? `records/${id}` : 'records', sent);
            setId(saved.id);
            setVersion(saved.version);
            setStatus(saved.status);
            setConflict(null);
            changed.current = false;
            localStorage.removeItem(localKey.current);
            localKey.current = `garden-draft:${saved.id}`;
            setMessage(`已保存 · ${new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}`);
            setRecovered(false);
            onSaved(saved);
            return saved;
        }
        catch (e) {
            const err = e as ClientError;
            setError(err.message);
            setMessage('输入已保留');
            if (err.status === 409 && err.details)
                setConflict(err.details as GardenRecord);
            return null;
        }
        finally {
            saving.current = false;
            setBusy(false);
        }
    }
    function insert(before: string, after = '') { const area = bodyRef.current; const start = area?.selectionStart ?? body.length, end = area?.selectionEnd ?? body.length; setBody(body.slice(0, start) + before + body.slice(start, end) + after + body.slice(end)); touch(); setTimeout(() => { area?.focus(); area?.setSelectionRange(start + before.length, end + before.length); }, 0); }
    async function op(operation: string, extra: Record<string, unknown> = {}) { const saved = changed.current ? await save() : id ? { id, version } : await save(); if (!saved)
        return; setBusy(true); try {
        const result = await api<GardenRecord>(`records/${saved.id}/${operation}`, { version: saved.version, ...extra });
        setVersion(result.version);
        setStatus(result.status);
        if (operation === 'revision' || operation === 'published-revision') {
            setTitle(result.title);
            setBody(result.body);
            setFields(result.fields);
            setTags(result.tags.join(', '));
            setLinks(result.links.map(l => ({ toId: l.toId, relation: l.relation })));
        }
        if (operation === 'snapshot')
            setFields(result.fields);
        setAttachments(result.attachments);
        onSaved(result);
        setMessage('操作完成');
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    async function upload(file: File) { const saved = id ? { id } : await save(); if (!saved)
        return; setBusy(true); try {
        const form = new FormData();
        form.set('recordId', saved.id);
        form.set('file', file);
        const response = await fetch('/api/workspace/files/upload', { method: 'POST', body: form });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error.message);
        setAttachments(prev => [...prev, result.data]);
        setMessage('附件已保存，可插入正文或选择公开');
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    const availableAssets = [...attachments, ...all.filter(r => links.some(l => l.toId === r.id && l.relation === 'source')).flatMap(r => r.attachments)];
    function fieldInput(field: Field) {
        const value = fields[field.key];
        const update = (v: unknown) => { setFields(prev => ({ ...prev, [field.key]: v })); touch(); };
        if (field.type === 'checkbox')
            return <label className="checkbox-field" key={field.key}><input type="checkbox" checked={value === true} onChange={e => update(e.target.checked)}/>{field.label}</label>;
        if (field.type === 'textarea')
            return <label key={field.key}>{field.label}<textarea rows={3} value={String(value || '')} onChange={e => update(e.target.value)}/></label>;
        if (field.type === 'select')
            return <label key={field.key}>{field.label}<select aria-label={field.label} value={String(value || field.options?.[0] || '')} onChange={e => update(e.target.value)}><option value="" disabled>请选择</option>{field.options?.map(x => <option key={x} value={x}>{statusLabels[x] || x}</option>)}</select></label>;
        if (field.type === 'date')
            return <label key={field.key}>{field.label}（上海时间）<input type="datetime-local" value={localDate(value)} onChange={e => update(e.target.value ? new Date(`${e.target.value}:00+08:00`).toISOString() : null)}/></label>;
        if (field.type === 'account' || field.type === 'record')
            return <label key={field.key}>{field.label}<select value={String(value || '')} onChange={e => update(e.target.value)}><option value="">请选择</option>{all.filter(r => r.id !== id && r.kind === (field.type === 'account' ? 'ACCOUNT' : 'ACTION')).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>;
        if (field.type === 'money')
            return <label key={field.key}>{field.label}<MoneyInput value={value} update={update}/></label>;
        return <label key={field.key}>{field.label}<input type={field.type === 'number' ? 'number' : 'text'} value={value === undefined ? '' : String(value)} onChange={e => update(field.type === 'number' ? Number(e.target.value) : e.target.value)}/></label>;
    }
    const renderedBody = body.replace(/\[\[([^\]]+)\]\]/g, (_, ref) => { const target = all.find(r => r.id === ref); return target ? `[${target.title}](/workspace/records/${target.id})` : `［未找到引用：${ref}］`; });
    return <div className="modal-backdrop"><section className="editor-modal" role="dialog" aria-modal="true" aria-label={`编辑${definition.label}`}><header className="editor-header"><div><span className="eyebrow">{definition.label}</span><span className="save-status" role="status">{message || '内容默认私密'}</span></div><div><button className="icon-button" aria-label="版本历史" onClick={async () => { setHistory(!history); if (id) {
        const latest = await api<GardenRecord>(`records/${id}`);
        revisionList.current = latest.revisions || [];
        setRenderVersion(x => x + 1);
    } }}><History size={18}/></button><button className="icon-button" aria-label="关闭编辑" onClick={() => { if (changed.current)
        localStorage.setItem(localKey.current, JSON.stringify({ ...payload(), savedAt: Date.now() })); onClose(); }}><X size={21}/></button></div></header>
    {recovered && <div className="notice">已恢复上次未保存的输入，请检查后保存。</div>}{error && <div className="error-message" role="alert">{error}</div>}
    {conflict && <div className="conflict-box"><h3>这条记录有新版本</h3><p>你的输入仍在编辑器中。远端版本：</p><pre>{conflict.title + '\n' + conflict.body + '\n' + JSON.stringify(conflict.fields, null, 2)}</pre><div className="toolbar"><button onClick={() => { setVersion(conflict.version); setConflict(null); touch(); }}>保留输入，使用最新版本重试</button><button onClick={() => { setTitle(conflict.title); setBody(conflict.body); setFields(conflict.fields); setTags(conflict.tags.join(', ')); setLinks(conflict.links.map(l => ({ toId: l.toId, relation: l.relation }))); setVersion(conflict.version); setStatus(conflict.status); setConflict(null); changed.current = false; localStorage.removeItem(localKey.current); }}>采用远端内容</button></div></div>}
    <fieldset className="editor-scroll" disabled={busy}><label className="title-field">标题<input aria-label="标题" value={title} placeholder="给这段记录一个名字" onChange={e => { setTitle(e.target.value); touch(); }}/></label><div className="editor-top-fields"><label>状态<select disabled={currentKind === 'PUBLICATION'} value={status} onChange={e => { setStatus(e.target.value); touch(); }}>{definition.statuses.map(x => <option key={x} value={x}>{statusLabels[x]}</option>)}</select></label><label>标签（逗号分隔）<input value={tags} onChange={e => { setTags(e.target.value); touch(); }} placeholder="学习, 实践"/></label></div>
    <div className="markdown-toolbar"><button onClick={() => insert('## ')}>标题</button><button onClick={() => insert('**', '**')}>粗体</button><button onClick={() => insert('- ')}>列表</button><button onClick={() => insert('> ')}>引用</button><button onClick={() => insert('[链接文字](', ')')}>链接</button><button onClick={() => insert('\n```text\n', '\n```\n')}>代码</button><button onClick={() => insert('$', '$')}>公式</button><button onClick={() => setPreview(!preview)} className={preview ? 'selected' : ''}><Eye size={15}/>预览</button></div><div className={`markdown-edit ${preview ? 'split' : ''}`}><textarea ref={bodyRef} aria-label="正文" className="body-editor" placeholder="写下观察、想法与过程……支持 Markdown。" value={body} onChange={e => { setBody(e.target.value); touch(); }}/>{preview && <div className="editor-preview"><Markdown body={renderedBody}/></div>}</div>
    <details className="editor-details" open={currentKind !== 'NOTE'}><summary>专门字段与安排</summary><div className="field-grid">{definition.fields.map(fieldInput)}</div></details>
    <details className="editor-details" open><summary><Link2 size={15}/>关联与来源</summary><div className="linked-list">{links.map((l, i) => { const r = all.find(x => x.id === l.toId); return <div key={i}><a href={`/workspace/records/${l.toId}`}>{r?.title || record?.links.find(x => x.toId === l.toId)?.title || l.toId}</a><span>{{ related: '关联', source: '素材来源', action: '后续行动', evidence: '证据', chapter: '章节', assignment: '作业' }[l.relation]}</span><button aria-label="移除关联" onClick={() => { setLinks(links.filter((_, index) => index !== i)); touch(); }}><X size={14}/></button></div>; })}</div><div className="add-link-row"><select aria-label="关联对象" value={addTarget} onChange={e => setAddTarget(e.target.value)}><option value="">选择领域、项目、笔记或其他记录</option>{all.filter(x => x.id !== id).map(x => <option key={x.id} value={x.id}>{definitions[x.kind].label} · {x.title}</option>)}</select><select aria-label="关联类型" value={relation} onChange={e => setRelation(e.target.value)}><option value="related">关联</option><option value="source">素材来源</option><option value="action">后续行动</option><option value="evidence">证据</option><option value="chapter">章节</option><option value="assignment">实验 / 作业</option></select><button className="button secondary" aria-label="添加关联" onClick={() => { if (addTarget && !links.some(l => l.toId === addTarget && l.relation === relation)) {
        setLinks([...links, { toId: addTarget, relation }]);
        setAddTarget('');
        touch();
    } }}><Plus size={15}/></button></div>{record?.backlinks.length ? <p className="backlinks">被引用于：{record.backlinks.map(l => <a key={l.id} href={`/workspace/records/${l.fromId}`}>{l.title}</a>)}</p> : null}</details>
    <details className="editor-details"><summary><Upload size={15}/>附件</summary><label className="upload-control">添加图片、PDF 或文本<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file)
        void upload(file); e.target.value = ''; }}/></label>{attachments.map(a => <div key={a.id} className="attachment-row"><a href={`/api/workspace/files/${a.id}`} target="_blank" rel="noreferrer">{a.name}</a><small>{Math.ceil(a.size / 1024)} KB</small><button onClick={() => insert(`${a.mime.startsWith('image/') ? '!' : ''}[${a.name}](/api/workspace/files/${a.id})`)}>插入正文</button></div>)}</details>
    {currentKind === 'PUBLICATION' && <details className="editor-details" open><summary>公开附件选择</summary><p className="muted">仅勾选的附件会复制到公开版本。正文中的内部链接需要整理为公开表达。</p>{availableAssets.length ? availableAssets.map(a => <label key={a.id} className="checkbox-field"><input type="checkbox" checked={Array.isArray(fields.selectedAssets) && fields.selectedAssets.includes(a.id)} onChange={e => { const ids = Array.isArray(fields.selectedAssets) ? fields.selectedAssets : []; setFields({ ...fields, selectedAssets: e.target.checked ? [...ids, a.id] : ids.filter(x => x !== a.id) }); touch(); }}/>{a.name}</label>) : <p className="muted">当前没有附件；可以上传附件，或将有附件的记录关联为素材来源。</p>}</details>}
    {currentKind === 'REVIEW' && <section className="editor-details"><h3>当时的证据</h3><button className="button secondary" disabled={busy} onClick={() => op('snapshot')}>保存关联记录快照</button>{Boolean(fields.snapshots) && <pre className="snapshot-pre">{JSON.stringify(JSON.parse(String(fields.snapshots)), null, 2)}</pre>}</section>}
    {history && <section className="editor-details" key={renderVersion}><h3>可恢复的编辑版本</h3>{revisionList.current.length ? revisionList.current.map(r => <div className="attachment-row" key={r.id}><span>{formatDate(r.createdAt)}</span><button onClick={() => op('revision', { revisionId: r.id })}>恢复到草稿</button></div>) : <p className="muted">保存修改后，会留下旧版本。</p>}{record?.publishedVersions?.map(r => <div className="attachment-row" key={r.id}><span>发布版本 · {formatDate(r.createdAt)}</span><button onClick={() => op('published-revision', { revisionId: r.id })}>恢复为新草稿</button></div>)}</section>}
    </fieldset><footer className="editor-footer"><span className="muted">{id ? '自动保存开启' : '首次保存后开启自动保存'}</span><div>{currentKind === 'PUBLICATION' && id && <><a className="button secondary" href={`/preview/${id}`} target="_blank" rel="noreferrer"><Eye size={15}/>预览</a>{Boolean(fields.currentVersionId) && <button className="button secondary" disabled={busy} onClick={() => op('withdraw')}>撤回</button>}<button className="button primary" disabled={busy || !!conflict} onClick={() => op('publish')}>发布当前稿件</button></>}<button className="button secondary" disabled={busy || !!conflict} onClick={() => save()}><Save size={16}/>{busy ? '保存中……' : '保存'}</button></div></footer>
    </section></div>;
}
function MoneyInput({ value, update }: {
    value: unknown;
    update: (v: unknown) => void;
}) { const [raw, setRaw] = useState(value === undefined ? '' : (Number(value) / 100).toFixed(2)); const focused = useRef(false); useEffect(() => { if (!focused.current)
    setRaw(value === undefined ? '' : (Number(value) / 100).toFixed(2)); }, [value]); return <input inputMode="decimal" value={raw} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onChange={e => { const text = e.target.value; setRaw(text); if (!/^-?\d*(\.\d{0,2})?$/.test(text)) {
    update(Number.NaN);
    return;
} const [whole, fraction = ''] = text.replace('-', '').split('.'); update((Number(whole || 0) * 100 + Number(fraction.padEnd(2, '0'))) * (text.startsWith('-') ? -1 : 1)); }}/>; }
