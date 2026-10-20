import { currentOwner } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Workbench } from '@/components/workbench';
export const dynamic = 'force-dynamic';
export const metadata = { title: '个人工作台', robots: { index: false, follow: false } };
export default async function Workspace({ params }: {
    params: Promise<{
        segments?: string[];
    }>;
}) { const owner = await currentOwner(); if (!owner)
    redirect('/login'); const { segments } = await params; return <Workbench route={segments || []} username={owner.username}/>; }
