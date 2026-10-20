export class ClientError extends Error {
    constructor(message: string, public status: number, public details?: unknown) { super(message); }
}
// 登出瞬间，工作台上仍在途的请求会收到 401；置位后 api() 不再重定向到 /login，避免抢掉登出后的跳转。
let signingOut = false;
export function markSigningOut() { signingOut = true; }
export async function api<T = any>(path: string, body?: unknown): Promise<T> { const response = await fetch(`/api/workspace/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); const result = await response.json(); if (!response.ok) {
    if (response.status === 401 && !signingOut)
        window.location.assign('/login');
    throw new ClientError(result.error?.message || '操作失败', response.status, result.error?.details);
} return result.data; }
