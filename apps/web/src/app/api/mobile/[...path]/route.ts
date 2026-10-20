import { AppError } from '@/lib/store';
import { ok, failure } from '@/lib/http';
import { db } from '@/lib/db';
import { checkMobileTransport, redeemPairing, requireMobile, mobileSnapshot, createMobileTask, updateMobileTask, deleteMobileTask } from '@/lib/mobile';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
async function dispatch(request: Request, context: Context) {
  try {
    checkMobileTransport(request);
    const parts = (await context.params).path;
    const body = async () => {
      const text = await request.text();
      if (text.length > 4096) throw new AppError(413, '请求内容过大');
      try { return JSON.parse(text); } catch { throw new AppError(400, '请求格式不正确'); }
    };
    if (request.method === 'POST' && parts.length === 1 && parts[0] === 'pair') return ok(await redeemPairing(await body()));
    const session = await requireMobile(request);
    if (request.method === 'POST' && parts.length === 1 && parts[0] === 'logout') {
      await db.mobileSession.delete({ where: { id: session.id } });
      return ok({ disconnected: true });
    }
    if (parts[0] === 'tasks' && parts.length === 1) {
      if (request.method === 'GET') return ok(await mobileSnapshot());
      if (request.method === 'POST') return ok(await createMobileTask(session.id, await body()), 201);
    }
    if (parts[0] === 'tasks' && parts.length === 2) {
      if (request.method === 'PATCH') return ok(await updateMobileTask(parts[1], await body()));
      if (request.method === 'DELETE') return ok(await deleteMobileTask(parts[1], await body()));
    }
    throw new AppError(404, '接口不存在');
  } catch (error) {
    // Do not expose full private records carried by the workspace's conflict errors.
    return failure(error instanceof AppError ? new AppError(error.status, error.message) : error);
  }
}
export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
