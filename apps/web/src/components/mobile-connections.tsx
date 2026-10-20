'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
type Device = { id: string; label: string; expiresAt: string };
export function MobileConnections() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function refresh() { setDevices(await api<Device[]>('mobile')); }
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  async function operate(body: object) {
    setBusy(true); setError('');
    try {
      const result = await api<{ code: string; expiresAt: string }>('mobile', body);
      if ('code' in result) setPair(result);
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="dashboard-panel" style={{ marginBottom: 28 }}>
    <h2>手机任务看板</h2>
    <p>在手机选择“连接博客”，填写电脑的局域网地址和配对码。手机可管理行动任务，其他私密内容不会开放给手机接口。</p>
    <p>本地连接需要电脑保持运行、手机与电脑处于同一 Wi-Fi。云端部署后可重新配对 HTTPS 域名。</p>
    <button className="button secondary" disabled={busy} onClick={() => operate({ action: 'pair' })}>生成手机配对码</button>
    <button className="button secondary" disabled={busy} style={{ marginLeft: 8 }} onClick={() => { void refresh().catch(e => setError(e.message)); }}>刷新连接列表</button>
    {pair && <p role="status">配对码：<strong style={{ fontSize: 26, letterSpacing: 3 }}>{pair.code}</strong>（一次有效，{new Date(pair.expiresAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })} 前使用；请勿分享）</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    <ul>{devices.map(device => <li key={device.id} style={{ marginTop: 12 }}>{device.label} · 有效至 {new Date(device.expiresAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })} <button disabled={busy} className="button secondary" onClick={() => operate({ action: 'revoke', id: device.id })}>撤销连接</button></li>)}</ul>
  </section>;
}
