import type { Metadata } from 'next';
import './globals.css';
import 'katex/dist/katex.min.css';
export const metadata: Metadata = { title: { default: '个人数字花园', template: '%s · 数字花园' }, description: '个人作品、写作与成长的数字花园', metadataBase: new URL(process.env.SITE_URL || 'http://localhost:3000') };
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) { return <html lang="zh-CN"><body>{children}</body></html>; }
