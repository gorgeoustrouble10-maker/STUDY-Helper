'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Sprout, ArrowRight } from 'lucide-react';
export function LoginForm() { const [error, setError] = useState(''), [busy, setBusy] = useState(false); return <main className="login-page"><Link href="/" className="brand"><Sprout size={25}/> 回到花园</Link><form className="login-card" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); const form = new FormData(e.currentTarget); try {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
    const data = await response.json();
    if (!response.ok)
        throw new Error(data.error?.message || '登录失败');
    window.location.assign('/workspace');
}
catch (e) {
    setError((e as Error).message);
}
finally {
    setBusy(false);
} }}><span className="eyebrow">A QUIET PLACE TO BEGIN</span><h1>回到自己的工作台。</h1><p>整理思绪，选好下一步。</p><label>账号<input name="username" autoComplete="username" required/></label><label>密码<input name="password" type="password" autoComplete="current-password" required/></label>{error && <p role="alert" className="error-message">{error}</p>}<button className="button primary" disabled={busy}>{busy ? '正在登录……' : '进入工作台'}<ArrowRight size={17}/></button><small>仅所有者可访问。首次使用请在终端运行 npm run owner:init。</small></form></main>; }
