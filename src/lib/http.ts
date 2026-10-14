import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from './store';
export const ok = (data: unknown, status = 200) => NextResponse.json({ data }, { status, headers: { 'Cache-Control': 'no-store' } });
export function failure(error: unknown) { if (error instanceof AppError)
    return NextResponse.json({ error: { message: error.message, details: error.details } }, { status: error.status, headers: { 'Cache-Control': 'no-store' } }); if (error instanceof ZodError)
    return NextResponse.json({ error: { message: error.issues[0]?.message || '填写内容不正确' } }, { status: 400 }); if ((error as {
    code?: string;
})?.code === 'P2002')
    return NextResponse.json({ error: { message: '链接标识或名称已存在，请使用其他名称' } }, { status: 409 }); console.error(error); return NextResponse.json({ error: { message: '暂时无法完成操作，请重试。输入会保留。' } }, { status: 500 }); }
