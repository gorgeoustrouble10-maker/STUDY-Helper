import { currentOwner } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login';
export const dynamic = 'force-dynamic';
export const metadata = { title: '登录工作台', robots: { index: false, follow: false } };
export default async function Login() { if (await currentOwner())
    redirect('/workspace'); return <LoginForm />; }
