export class ClientError extends Error {
    constructor(message: string, public status: number, public details?: unknown) { super(message); }
}
export async function api<T = any>(path: string, body?: unknown): Promise<T> { const response = await fetch(`/api/workspace/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); const result = await response.json(); if (!response.ok) {
    if (response.status === 401)
        window.location.assign('/login');
    throw new ClientError(result.error?.message || '操作失败', response.status, result.error?.details);
} return result.data; }
