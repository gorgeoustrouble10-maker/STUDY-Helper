import * as SecureStore from "expo-secure-store";
import type { Repository, RecordData } from "./data";

export const API_URL = "http://121.43.32.47/api/mobile/v1";
export type Session = {
  user: { id: string; username: string };
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
};
export class NetworkError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = "NETWORK",
  ) {
    super(message);
  }
}
export async function request<T>(
  route: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    response = await fetch(API_URL + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new NetworkError("暂时无法连接云端。已保存的记录仍可离线使用。");
  } finally {
    clearTimeout(timeout);
  }
  let json;
  try {
    json = await response.json();
  } catch {
    throw new NetworkError("云端响应异常，请稍后重试", response.status);
  }
  if (!response.ok)
    throw new NetworkError(
      json.error?.message || "请求失败",
      response.status,
      json.error?.code,
    );
  return json.data as T;
}
export const sessionKey = "garden.session.v1";
export async function persist(session: Session) {
  await SecureStore.setItemAsync(sessionKey, JSON.stringify(session));
}
export async function restore(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(sessionKey);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    return session.user?.id && session.refreshToken ? session : null;
  } catch {
    return null;
  }
}

export async function synchronize(
  repo: Repository,
  authorized: <T>(route: string, body?: unknown) => Promise<T>,
  refresh: () => void,
) {
  let firstError = "";
  for (let round = 0; round < 10; round++) {
    let bytes = 0;
    const pending = repo.prepare().filter((p) => {
      bytes += p.payload.length * 3 + 200;
      return bytes < 400000;
    });
    if (!pending.length) break;
    const data = await authorized<{
      results: {
        operationId: string;
        status: string;
        record?: RecordData;
        remote?: RecordData;
        message?: string;
      }[];
    }>("/sync/push", {
      operations: pending.map((p) => ({
        operationId: p.operationId,
        baseVersion: p.baseVersion,
        record: JSON.parse(p.payload),
      })),
    });
    let error = "";
    for (const p of pending) {
      const result = data.results.find((r) => r.operationId === p.operationId);
      if (result?.status === "ok" && result.record)
        repo.acknowledge(p, result.record);
      else if (result?.status === "conflict" && result.remote)
        repo.conflict(p.id, result.remote);
      else {
        if (result?.status === "error") repo.reject(p.id);
        error = result?.message || "部分记录未同步，请稍后重试";
      }
    }
    refresh();
    if (error) {
      firstError = error;
      break;
    }
  }
  let more = true;
  while (more) {
    const data = await authorized<{
      changes: { record: RecordData }[];
      cursor: number;
      hasMore: boolean;
    }>(`/sync/pull?cursor=${repo.cursor()}`);
    repo.page(data.changes, data.cursor);
    refresh();
    more = data.hasMore;
  }
  if (firstError) throw new NetworkError(firstError);
}
