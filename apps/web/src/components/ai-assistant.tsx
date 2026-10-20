'use client';
// 工作台悬浮 AI 助手：桌面右侧 400px 面板，移动端全屏。
// 只在服务器启用 AI 时渲染；所有写入类操作在此面板内确认/拒绝/撤销。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage, type ToolUIPart } from 'ai';
import { Sparkles, X, Send, Square, Undo2 } from 'lucide-react';
import { api } from '@/lib/client';

type AiStatus = { enabled: boolean; provider: string | null; model: string | null };
type ConversationItem = { id: string; title: string | null; updatedAt: string; lastMessage: { role: string; preview: string } | null };
type ToolData = {
    operationId?: string;
    hash?: string;
    recordId?: string;
    version?: number;
    title?: string;
    changes?: string[];
    expectedVersion?: number;
    operation?: string;
    evidenceCount?: number;
    note?: string;
    replayed?: boolean;
};
type ToolOutput = { ok: true; data: ToolData } | { ok: false; error: string; message?: string };

const operationLabels: Record<string, string> = { complete: '标记完成', reopen: '重新打开', archive: '归档', unarchive: '取消归档' };
const createTools = ['tool-create_record', 'tool-draft_publication'];
const proposeTools = ['tool-propose_record_change', 'tool-propose_record_operation', 'tool-propose_review_snapshot'];

function turnId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function AiAssistant({ currentRecordId, onDataChanged }: {
    currentRecordId?: string;
    onDataChanged: () => void;
}) {
    const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<'ANALYSIS' | 'WORK'>('ANALYSIS');
    const [conversations, setConversations] = useState<ConversationItem[]>([]);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [opStatus, setOpStatus] = useState<Record<string, { decided?: 'APPLIED' | 'REJECTED'; undone?: boolean; error?: string }>>({});
    const [draft, setDraft] = useState('');
    const transport = useMemo(() => new DefaultChatTransport({ api: '/api/workspace/ai/chat' }), []);
    const dataChangedRef = useRef(onDataChanged);
    dataChangedRef.current = onDataChanged;
    const { messages, sendMessage, status: chatStatus, stop, error, setMessages, clearError } = useChat({
        transport,
        onError: () => {},
        onFinish: () => {
            // 一轮结束后刷新工作台数据（可能产生了新记录）与对话列表
            dataChangedRef.current();
            void loadConversations();
        },
    });
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => { void api<AiStatus>('ai/status').then(setAiStatus).catch(() => setAiStatus({ enabled: false, provider: null, model: null })); }, []);
    useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);
    useEffect(() => { if (localStorage.getItem('garden-ai-mode') === 'WORK') setMode('WORK'); }, []);
    useEffect(() => { if (mode === 'WORK') localStorage.setItem('garden-ai-mode', 'WORK'); else localStorage.removeItem('garden-ai-mode'); }, [mode]);

    const streaming = chatStatus === 'submitted' || chatStatus === 'streaming';
    async function loadConversations() {
        try {
            setConversations(await api<{ list: ConversationItem[] }>('ai/conversations').then(r => r.list));
        }
        catch {
            // 列表加载失败不影响对话
        }
    }
    function openPanel() {
        setOpen(true);
        void loadConversations();
    }
    async function switchConversation(id: string | null) {
        if (id === conversationId)
            return;
        clearError();
        setOpStatus({});
        setConversationId(id);
        if (!id) {
            setMessages([]);
            return;
        }
        try {
            const data = await api<{ messages: { id: string; role: string; parts: unknown }[] }>(`ai/conversations/${id}`);
            setMessages(data.messages.map(m => ({ id: m.id, role: m.role as 'user' | 'assistant', parts: m.parts } as UIMessage)));
        }
        catch (e) {
            setMessages([]);
            setOpStatus({ _load: { error: (e as Error).message } });
        }
    }
    async function send(text: string) {
        clearError();
        let convId = conversationId;
        if (!convId) {
            setCreating(true);
            try {
                const created = await api<{ id: string }>('ai/conversations', { title: text.slice(0, 40) });
                convId = created.id;
                setConversationId(created.id);
                void loadConversations();
            }
            catch (e) {
                setCreating(false);
                setOpStatus({ _send: { error: (e as Error).message } });
                return;
            }
            setCreating(false);
        }
        await sendMessage({ text }, { body: { conversationId: convId, mode, clientTurnId: turnId(), contextRecordIds: currentRecordId ? [currentRecordId] : [] } });
    }
    // key 用工具卡片的 toolCallId（与 toolCard 的 opStatus 读取键一致），operationId 仅用于接口路径。
    async function decide(key: string, operationId: string, decision: 'confirm' | 'reject', expectedHash?: string) {
        if (!expectedHash)
            return;
        try {
            await api(`ai/operations/${operationId}/decision`, { decision, expectedHash });
            setOpStatus(s => ({ ...s, [key]: { decided: decision === 'confirm' ? 'APPLIED' : 'REJECTED' } }));
            onDataChanged();
            void loadConversations();
        }
        catch (e) {
            setOpStatus(s => ({ ...s, [key]: { error: (e as Error).message } }));
        }
    }
    async function undoCreate(key: string, operationId: string) {
        try {
            await api(`ai/operations/${operationId}/undo-create`, {});
            setOpStatus(s => ({ ...s, [key]: { undone: true } }));
            onDataChanged();
        }
        catch (e) {
            setOpStatus(s => ({ ...s, [key]: { error: (e as Error).message } }));
        }
    }

    if (!aiStatus?.enabled)
        return null;

    function toolCard(part: ToolUIPart) {
        const op = opStatus[part.toolCallId] || {};
        if (part.state === 'input-streaming')
            return <div className="ai-tool"><span className="ai-tool-meta">正在准备操作……</span></div>;
        if (part.state === 'input-available')
            return <div className="ai-tool"><span className="ai-tool-meta">执行中……</span></div>;
        if (part.state === 'output-error')
            return <div className="ai-tool error">执行出错：{part.errorText}</div>;
        const output = part.output as ToolOutput;
        if (!output.ok)
            return <div className="ai-tool error">{output.message || output.error}</div>;
        const d = output.data;
        const opId = d.operationId;
        const decided = op.decided;
        if (createTools.includes(part.type))
            return <div className="ai-tool"><div className="ai-tool-top"><span>已创建记录{d.replayed ? '（重放）' : ''}</span>{d.recordId && <a className="ai-tool-meta" href={`/workspace/records/${d.recordId}`}>查看 ↗</a>}</div>{d.title && <span>{d.title}{d.version ? ` · 版本 ${d.version}` : ''}</span>}{opId && !op.undone && !op.decided && <button className="button secondary" onClick={() => undoCreate(part.toolCallId, opId)}><Undo2 size={13}/>撤销这条新增</button>}{op.undone && <span className="ai-tool-meta">已撤销（记录进入回收站）</span>}{d.note && <span className="ai-tool-meta">{d.note}</span>}{op.error && <span className="ai-tool-meta" style={{ color: 'var(--error)' }}>{op.error}</span>}</div>;
        if (proposeTools.includes(part.type)) {
            const title = part.type === 'tool-propose_record_change' ? '修改提议'
                : part.type === 'tool-propose_record_operation' ? `操作提议：${operationLabels[d.operation || ''] || d.operation}` : '复盘快照提议';
            const detail = part.type === 'tool-propose_record_change' ? (d.changes?.length ? `改动：${d.changes.join('、')}` : '内容更新')
                : part.type === 'tool-propose_review_snapshot' ? `引用 ${d.evidenceCount ?? 0} 条证据记录` : d.recordId ? `记录 ${d.recordId.slice(0, 8)}…` : '';
            const pending = !decided && !op.undone;
            return <div className="ai-tool"><div className="ai-tool-top"><span>{title}</span>{d.recordId && <a className="ai-tool-meta" href={`/workspace/records/${d.recordId}`}>查看 ↗</a>}</div><span className="ai-tool-meta">{detail}{d.expectedVersion ? ` · 预期版本 ${d.expectedVersion}` : ''}</span>{d.note && <span className="ai-tool-meta">{d.note}</span>}{pending && <div className="ai-tool-actions"><button className="button primary" onClick={() => opId && decide(part.toolCallId, opId, 'confirm', d.hash)}>确认执行</button><button className="button secondary" onClick={() => opId && decide(part.toolCallId, opId, 'reject', d.hash)}>拒绝</button></div>}{decided === 'APPLIED' && <span className="ai-tool-meta">已确认并生效 ✓</span>}{decided === 'REJECTED' && <span className="ai-tool-meta">已拒绝，未改动记录</span>}{op.error && <span className="ai-tool-meta" style={{ color: 'var(--error)' }}>{op.error}</span>}</div>;
        }
        // 读取类工具：轻量展示
        return <div className="ai-tool"><span className="ai-tool-meta">已完成查询：{part.type.replace('tool-', '')}</span></div>;
    }

    return <>
        <button className="ai-fab" aria-label="AI 助手" onClick={() => (open ? setOpen(false) : openPanel())}><Sparkles size={22}/></button>
        {open && <div className="ai-panel" role="dialog" aria-label="AI 助手">
            <div className="ai-head">
                <strong style={{ fontSize: 13 }}>AI 助手</strong>
                <select aria-label="对话" value={conversationId ?? ''} onChange={e => switchConversation(e.target.value || null)}>
                    <option value="">新对话</option>
                    {conversations.map(c => <option key={c.id} value={c.id}>{c.title || '未命名对话'}</option>)}
                </select>
                <select aria-label="模式" value={mode} onChange={e => setMode(e.target.value as 'ANALYSIS' | 'WORK')}>
                    <option value="ANALYSIS">分析模式</option>
                    <option value="WORK">工作模式</option>
                </select>
                <button className="icon-button" aria-label="关闭面板" onClick={() => setOpen(false)}><X size={17}/></button>
            </div>
            <div className="ai-msgs" ref={listRef}>
                {!messages.length && <div className="ai-welcome">
                    <Sparkles size={20}/>
                    <p>{mode === 'WORK' ? '工作模式：可以让我直接新增记录，修改仍需你确认。' : '分析模式：我可以查询与提建议；修改需生成提议等你确认。'}</p>
                    {currentRecordId && <small>将自动携带当前记录作为上下文。</small>}
                </div>}
                {messages.map(m => <div key={m.id} className={`ai-msg ${m.role}`}>
                    {m.parts.map((p, i) => {
                        if (p.type === 'text')
                            return <p key={i}>{p.text}</p>;
                        if (p.type.startsWith('tool-'))
                            return <div key={i} style={{ marginTop: 8 }}>{toolCard(p as ToolUIPart)}</div>;
                        return null;
                    })}
                </div>)}
                {error && <div className="ai-tool error">{error.message}<button className="button secondary" onClick={() => {
                    const last = [...messages].reverse().find(x => x.role === 'user');
                    if (last) {
                        const text = last.parts.find(x => x.type === 'text');
                        if (text && 'text' in text)
                            void send(text.text);
                    }
                }}>重试</button></div>}
                {opStatus._load?.error && <div className="ai-tool error">{opStatus._load.error}</div>}
            </div>
            <div className="ai-hint">{mode === 'WORK' ? '工作模式：新增直接保存（有限额），修改需确认。' : '分析模式：只读取与提议，不改动记录。'}{currentRecordId ? ' 携带当前记录上下文。' : ''}</div>
            <div className="ai-input">
                <textarea placeholder={streaming ? '正在回复……' : '向 AI 助手提问'} value={draft} disabled={streaming || creating}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && draft.trim() && !streaming && !creating) { e.preventDefault(); const text = draft.trim(); setDraft(''); void send(text); } }}/>
                {streaming
                    ? <button className="button secondary" onClick={() => stop()}><Square size={14}/>停止</button>
                    : <button className="button primary" disabled={creating || !draft.trim() || chatStatus !== 'ready'} onClick={() => { const text = draft.trim(); if (!text)
                        return; setDraft(''); void send(text); }}>
                        <Send size={14}/>发送
                    </button>}
            </div>
        </div>}
    </>;
}
