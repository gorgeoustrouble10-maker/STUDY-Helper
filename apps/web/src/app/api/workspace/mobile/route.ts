import { requireOwner, checkOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { issuePairing } from '@/lib/mobile';
import { AppError } from '@/lib/store';
import { ok, failure } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET() {
  try {
    await requireOwner();
    return ok(await db.mobileSession.findMany({ where: { expiresAt: { gt: new Date() } }, select: { id: true, label: true, createdAt: true, expiresAt: true }, orderBy: { createdAt: 'desc' } }));
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    await requireOwner(); checkOrigin(request);
    const body = await request.json();
    if (body.action === 'pair') return ok(await issuePairing());
    if (body.action === 'revoke' && typeof body.id === 'string') {
      await db.mobileSession.deleteMany({ where: { id: body.id } });
      return ok({ revoked: true });
    }
    throw new AppError(400, '操作无效');
  } catch (e) { return failure(e); }
}
