import { cookies } from 'next/headers';
import { checkOrigin, currentOwner, login, cookieName, tokenHash } from '@/lib/auth';
import { db } from '@/lib/db';
import { ok, failure } from '@/lib/http';
import { AppError } from '@/lib/store';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: {
    params: Promise<{
        action: string;
    }>;
}) { try {
    const { action } = await context.params;
    if (action !== 'me')
        throw new AppError(404, '接口不存在');
    return ok(await currentOwner());
}
catch (e) {
    return failure(e);
} }
export async function POST(request: Request, context: {
    params: Promise<{
        action: string;
    }>;
}) {
    try {
        checkOrigin(request);
        const { action } = await context.params;
        const jar = await cookies();
        if (action === 'login') {
            const body = await request.json();
            const result = await login(String(body.username || ''), String(body.password || ''), 'owner');
            jar.set(cookieName, result.token, { httpOnly: true, sameSite: 'lax', secure: Boolean(process.env.SITE_URL?.startsWith('https:')) || request.url.startsWith('https:'), path: '/', expires: result.expiresAt });
            return ok({ signedIn: true });
        }
        if (action === 'logout') {
            const token = jar.get(cookieName)?.value;
            if (token)
                await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
            jar.delete(cookieName);
            return ok({ signedIn: false });
        }
        throw new AppError(404, '接口不存在');
    }
    catch (e) {
        return failure(e);
    }
}
