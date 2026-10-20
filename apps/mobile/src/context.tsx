import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { TIME_ZONE } from "./dates";
import * as SecureStore from "expo-secure-store";
import { Repository, type RecordData, type LocalRecord } from "./data";
import {
  request,
  persist,
  restore,
  synchronize,
  sessionKey,
  NetworkError,
  type Session,
} from "./api";

type ContextValue = {
  ready: boolean;
  session: Session | null;
  records: LocalRecord[];
  busy: boolean;
  syncError: string;
  lastSync: string;
  notice: string;
  large: boolean;
  login: (
    username: string,
    password: string,
    inviteCode?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  sync: () => Promise<void>;
  save: (record: RecordData) => void;
  resolve: (id: string, local: boolean) => void;
  setLarge: (value: boolean) => void;
  draft: (id: string) => RecordData | null;
  storeDraft: (id: string, value: RecordData) => void;
  clearDraft: (id: string) => void;
  authorized: <T>(route: string, body?: unknown) => Promise<T>;
  aiCache: <T>(key: string) => T | null;
  storeAiCache: (key: string, value: unknown) => void;
};
const Context = createContext<ContextValue | null>(null);
export function Provider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false),
    [session, setSession] = useState<Session | null>(null),
    [records, setRecords] = useState<LocalRecord[]>([]),
    [busy, setBusy] = useState(false),
    [syncError, setSyncError] = useState(""),
    [lastSync, setLastSync] = useState(""),
    [notice, setNotice] = useState(""),
    [large, setLargeState] = useState(false);
  const sessionRef = useRef<Session | null>(null),
    repoRef = useRef<Repository | null>(null),
    running = useRef(false),
    refreshing = useRef<Promise<Session> | null>(null);
  const update = useCallback(() => {
    if (repoRef.current) setRecords(repoRef.current.list());
  }, []);
  const activate = useCallback(
    (value: Session) => {
      repoRef.current?.close();
      repoRef.current = new Repository(value.user.id);
      sessionRef.current = value;
      setSession(value);
      setSyncError("");
      setLastSync("");
      update();
    },
    [update],
  );
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const value = await restore();
        if (value && !disposed) activate(value);
        const font = await SecureStore.getItemAsync("garden.large-font");
        if (!disposed) setLargeState(font === "1");
      } catch {
        setSyncError("本地数据打开失败，请重启应用重试");
      } finally {
        if (!disposed) setReady(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [activate]);
  const authorized = useCallback(
    async <T,>(route: string, body?: unknown): Promise<T> => {
      const original = sessionRef.current;
      if (!original) throw new NetworkError("请先登录", 401);
      try {
        const result = await request<T>(route, body, original.accessToken);
        if (sessionRef.current?.user.id !== original.user.id)
          throw new NetworkError("账号已切换");
        return result;
      } catch (e) {
        if (!(e instanceof NetworkError) || e.status !== 401) throw e;
        refreshing.current ||= request<Session>("/auth/refresh", {
          refreshToken: original.refreshToken,
        }).finally(() => {
          refreshing.current = null;
        });
        const next = await refreshing.current;
        if (sessionRef.current?.user.id !== original.user.id)
          throw new NetworkError("账号已切换");
        await persist(next);
        sessionRef.current = next;
        setSession(next);
        const result = await request<T>(route, body, next.accessToken);
        if (sessionRef.current?.user.id !== original.user.id)
          throw new NetworkError("账号已切换");
        return result;
      }
    },
    [],
  );
  const sync = useCallback(async () => {
    if (running.current || !repoRef.current || !sessionRef.current) return;
    const repo = repoRef.current;
    running.current = true;
    setBusy(true);
    setSyncError("");
    try {
      await synchronize(repo, authorized, update);
      setLastSync(
        new Date().toLocaleTimeString("zh-CN", {
          timeZone: TIME_ZONE,
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
      update();
    }
  }, [authorized, update]);
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    const initial = setTimeout(() => void sync(), 0);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    const timer = setInterval(() => {
      void sync();
    }, 45000);
    return () => {
      clearTimeout(initial);
      sub.remove();
      clearInterval(timer);
    };
  }, [userId, sync]);
  async function login(
    username: string,
    password: string,
    inviteCode?: string,
  ) {
    if (running.current) throw new Error("正在同步，请稍后再试");
    const value = await request<Session>(
      inviteCode === undefined ? "/auth/login" : "/auth/register",
      {
        username,
        password,
        ...(inviteCode === undefined ? {} : { inviteCode }),
      },
    );
    await persist(value);
    activate(value);
  }
  async function logout() {
    if (running.current) throw new Error("正在同步，请稍后退出");
    const token = sessionRef.current?.accessToken;
    if (token) {
      try {
        await request("/auth/logout", {}, token);
      } catch (e) {
        if (!(e instanceof NetworkError) || e.status !== 401)
          throw new Error("暂时无法注销云端会话，请联网后重试");
      }
    }
    await SecureStore.deleteItemAsync(sessionKey);
    repoRef.current?.close();
    repoRef.current = null;
    sessionRef.current = null;
    setSession(null);
    setRecords([]);
    setSyncError("");
    setNotice("");
  }
  function save(record: RecordData) {
    if (!repoRef.current) throw new Error("请先登录");
    repoRef.current.save(record);
    update();
    setNotice("已保存到手机");
    void sync();
  }
  function resolve(id: string, local: boolean) {
    repoRef.current?.resolve(id, local);
    update();
    void sync();
  }
  function setLarge(value: boolean) {
    setLargeState(value);
    void SecureStore.setItemAsync("garden.large-font", value ? "1" : "0");
  }
  const draft = useCallback((id: string) => repoRef.current?.draft(id), []);
  const storeDraft = useCallback(
    (id: string, value: RecordData) => repoRef.current?.storeDraft(id, value),
    [],
  );
  const clearDraft = useCallback(
    (id: string) => repoRef.current?.clearDraft(id),
    [],
  );
  const aiCache = useCallback(
    <T,>(key: string): T | null => repoRef.current?.aiCache<T>(key) ?? null,
    [],
  );
  const storeAiCache = useCallback(
    (key: string, value: unknown) => repoRef.current?.storeAiCache(key, value),
    [],
  );
  return (
    <Context.Provider
      value={{
        ready,
        session,
        records,
        busy,
        syncError,
        lastSync,
        notice,
        large,
        login,
        logout,
        sync,
        save,
        resolve,
        setLarge,
        draft,
        storeDraft,
        clearDraft,
        authorized,
        aiCache,
        storeAiCache,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useGarden() {
  const value = useContext(Context);
  if (!value) throw new Error("Provider missing");
  return value;
}
