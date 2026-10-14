import Link from 'next/link';
export default function NotFound() { return <main className="not-found"><span className="eyebrow">404 / 一条尚未长出的路径</span><h1>这页暂时不在这里。</h1><p>内容可能尚未公开，或已被收起。</p><Link className="button primary" href="/">回到花园</Link></main>; }
