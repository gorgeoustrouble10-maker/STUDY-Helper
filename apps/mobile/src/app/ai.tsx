import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGarden } from "../context";
import { blank } from "../data";
import type {
  AiConversation,
  AiDetail,
  AiPending,
  AiStatus,
  AiTurn,
} from "../ai-types";
import { Button, Chip, colors, Empty, Field, s } from "../ui";
import Markdown from "../components/Markdown";

export default function AiAssistant() {
  const { recordId } = useLocalSearchParams<{ recordId?: string }>();
  const { authorized, aiCache, storeAiCache, records, large, storeDraft } =
    useGarden();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>(
    () => aiCache<AiConversation[]>("list") || [],
  );
  const [detail, setDetail] = useState<AiDetail | null>(null);
  const [history, setHistory] = useState(false),
    [picker, setPicker] = useState(false);
  const [selected, setSelected] = useState<string[]>(
    recordId ? [recordId] : [],
  );
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<AiPending | null>(() =>
    aiCache<AiPending>("pending"),
  );
  const [turn, setTurn] = useState<AiTurn | null>(null);
  const alive = useRef(true),
    operation = useRef(false),
    viewGeneration = useRef(0);
  const scroll = useRef<ScrollViewInstance>(null);
  const invalidateView = useCallback(() => {
    viewGeneration.current++;
  }, []);

  const refreshList = useCallback(async () => {
    const data = await authorized<{ conversations: AiConversation[] }>(
      "/ai/conversations",
    );
    if (!alive.current) return;
    storeAiCache("list", data.conversations);
    setConversations(data.conversations);
  }, [authorized, storeAiCache]);
  const loadDetail = useCallback(
    async (id: string, generation: number) => {
      const value = await authorized<AiDetail>(`/ai/conversations/${id}`);
      if (!alive.current || viewGeneration.current !== generation) return null;
      storeAiCache(`conversation:${id}`, value);
      setDetail(value);
      return value;
    },
    [authorized, storeAiCache],
  );

  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const value = await authorized<AiStatus>("/ai/status");
        if (alive.current) setStatus(value);
        await refreshList();
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
    return () => {
      alive.current = false;
      invalidateView();
    };
  }, [authorized, refreshList, invalidateView]);

  async function openConversation(id: string) {
    if (operation.current) return;
    const generation = ++viewGeneration.current;
    setHistory(false);
    setError("");
    setTurn(null);
    setDetail(aiCache<AiDetail>(`conversation:${id}`));
    setLoading(true);
    try {
      const value = await loadDetail(id, generation);
      if (value?.activeTurn) setTurn(value.activeTurn);
    } catch (e) {
      if (alive.current)
        setError(`${(e as Error).message} 可阅读已缓存的历史。`);
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  async function follow(current: AiTurn, generation: number) {
    setTurn(current);
    // 模型在云端运行，短请求轮询兼容原生网络，也能在断线后恢复。
    for (let i = 0; i < 120; i++) {
      if (!alive.current || viewGeneration.current !== generation) return;
      if (current.status !== "running") {
        storeAiCache("pending", null);
        setPending(null);
        await loadDetail(current.conversationId, generation);
        await refreshList();
        if (current.status !== "completed")
          setError(current.error || "本次生成未完成");
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      if (!alive.current || viewGeneration.current !== generation) return;
      current = await authorized<AiTurn>(`/ai/turns/${current.id}`);
      if (alive.current) setTurn(current);
    }
    throw new Error("等待时间较长，可稍后恢复查看结果。");
  }
  async function send(recover = false) {
    if (operation.current || loading || (!recover && !message.trim())) return;
    operation.current = true;
    setBusy(true);
    setError("");
    const generation = viewGeneration.current;
    try {
      let input = recover ? pending : null;
      if (!input) {
        if (selected.some((id) => records.find((r) => r.id === id)?.dirty))
          throw new Error("参考记录有未同步修改，请先在同步中心完成同步。");
        let c = detail;
        if (!c) {
          c = await authorized<AiDetail>("/ai/conversations", {
            title: message.trim().slice(0, 40),
          });
          if (!alive.current) return;
          setDetail(c);
          storeAiCache(`conversation:${c.id}`, c);
        }
        input = {
          conversationId: c.id,
          requestId: randomUUID(),
          message: message.trim(),
          contextRecordIds: selected,
        };
        storeAiCache("pending", input);
        setPending(input);
        setMessage("");
      }
      const started = await authorized<AiTurn>(
        `/ai/conversations/${input.conversationId}/turns`,
        input,
      );
      if (!alive.current) return;
      await loadDetail(input.conversationId, generation);
      await follow(started, generation);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function resumeActive() {
    if (!turn || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await follow(turn, viewGeneration.current);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function cancel() {
    if (!turn) return;
    try {
      const current = await authorized<AiTurn>(
        `/ai/turns/${turn.id}/cancel`,
        {},
      );
      if (!alive.current) return;
      setTurn(current);
      // follow 下一次读取 cancelled 后结束，历史不保存不完整回复。
      if (!operation.current) {
        storeAiCache("pending", null);
        setPending(null);
        await loadDetail(current.conversationId, viewGeneration.current);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }
  function newConversation() {
    if (busy || pending) return;
    viewGeneration.current++;
    setDetail(null);
    setTurn(null);
    setHistory(false);
    setError("");
    setMessage("");
  }
  function saveAsNote(content: string) {
    Alert.alert("另存为笔记草稿", "回复会放入编辑器，确认内容后再保存。", [
      { text: "取消", style: "cancel" },
      {
        text: "打开草稿",
        onPress: () => {
          const draft = {
            ...blank("NOTE"),
            title: (detail?.title || "AI 分析").slice(0, 100),
            body: content,
          };
          storeDraft(draft.id, draft);
          router.push({
            pathname: "/edit",
            params: { id: draft.id, kind: "NOTE" },
          });
        },
      },
    ]);
  }
  const selectable = records
    .filter(
      (r) =>
        !r.deletedAt && !r.archivedAt && (!query || r.title.includes(query)),
    )
    .slice(0, 20);
  const blocked = !!pending || turn?.status === "running";
  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={{ padding: 16, gap: 10 }}>
        <View style={s.between}>
          <Text style={s.h2}>让记录帮助你思考</Text>
          <View style={s.row}>
            <Chip
              label="历史"
              active={history}
              onPress={() => {
                if (!busy) setHistory((v) => !v);
              }}
            />
            <Chip label="新会话" onPress={newConversation} />
          </View>
        </View>
        <Text style={s.small}>
          {status?.enabled
            ? `${status.model} · 分析模式`
            : status?.message ||
              (loading ? "正在连接 AI 服务…" : "离线 · 可阅读已缓存历史")}
        </Text>
        {!!error && (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        )}
      </View>
      <ScrollView
        ref={scroll}
        onContentSizeChange={() => {
          if (busy) scroll.current?.scrollToEnd({ animated: true });
        }}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 20,
          gap: 14,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {history ? (
          <>
            {!conversations.length && (
              <Empty
                title="还没有会话"
                body="启用 AI 后，可以开始第一次提问。"
              />
            )}
            {conversations.map((c) => (
              <Pressable
                accessibilityRole="button"
                key={c.id}
                style={s.card}
                onPress={() => void openConversation(c.id)}
              >
                <Text style={s.h2}>{c.title}</Text>
                <Text style={s.small}>
                  {new Date(c.updatedAt).toLocaleString("zh-CN")}
                </Text>
              </Pressable>
            ))}
          </>
        ) : (
          <>
            {!detail?.messages.length && (
              <View style={s.card}>
                <Text style={s.h2}>从一件具体的事开始</Text>
                <Text style={s.subtitle}>
                  可以整理今日行动、分析学习笔记或查询本月收支。AI
                  使用当前账号已同步的云端记录，回复可以另存为笔记。
                </Text>
                {[
                  "根据我的今日行动，建议今天的安排",
                  "帮我整理学习计划，缺少信息时先问我",
                  "汇总我本月的收入与支出",
                ].map((q) => (
                  <Chip key={q} label={q} onPress={() => setMessage(q)} />
                ))}
              </View>
            )}
            {detail?.messages.map((m) => (
              <View
                key={m.id}
                style={[
                  s.card,
                  m.role === "user" && { backgroundColor: colors.pale },
                ]}
              >
                <Text style={s.pillText}>
                  {m.role === "user" ? "你" : "知行助手"}
                </Text>
                <Markdown body={m.content} large={large} />
                {!!m.sources.length && (
                  <>
                    <Text style={s.small}>本次读取的参考记录</Text>
                    <View style={[s.row, { flexWrap: "wrap" }]}>
                      {m.sources.map((source) => (
                        <Chip
                          key={source.id}
                          label={source.title}
                          onPress={() => router.push(`/records/${source.id}`)}
                        />
                      ))}
                    </View>
                  </>
                )}
                {m.role === "assistant" && (
                  <Button
                    title="另存为笔记"
                    secondary
                    icon="document-text-outline"
                    onPress={() => saveAsNote(m.content)}
                  />
                )}
              </View>
            ))}
            {busy && (
              <View style={[s.row, { padding: 12 }]}>
                <ActivityIndicator color={colors.green} />
                <Text style={s.subtitle}>正在分析，可离开后从历史恢复查看</Text>
              </View>
            )}
            {turn?.status === "running" && (
              <View style={s.row}>
                {!busy && (
                  <Button
                    title="查看生成结果"
                    secondary
                    onPress={() => void resumeActive()}
                  />
                )}
                <Button
                  title="停止生成"
                  secondary
                  onPress={() => void cancel()}
                />
              </View>
            )}
            {pending && !busy && (
              <>
                <Text style={s.small}>
                  有上次未确认的请求，恢复会沿用原请求标识，避免重复生成。
                </Text>
                <Button title="恢复上次请求" onPress={() => void send(true)} />
                <Button
                  title="放弃本机等待"
                  secondary
                  onPress={() =>
                    Alert.alert(
                      "放弃等待",
                      "云端请求可能仍在运行，稍后可从历史查看。不会再次发送这个问题。",
                      [
                        { text: "取消", style: "cancel" },
                        {
                          text: "放弃等待",
                          onPress: () => {
                            storeAiCache("pending", null);
                            setPending(null);
                            setTurn(null);
                          },
                        },
                      ],
                    )
                  }
                />
              </>
            )}
          </>
        )}
      </ScrollView>
      {!history && (
        <View
          style={{
            padding: 16,
            paddingBottom: Math.max(16, insets.bottom),
            gap: 10,
            borderTopWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.bg,
          }}
        >
          <View style={[s.row, { flexWrap: "wrap" }]}>
            <Chip
              label={`参考记录 ${selected.length}/3`}
              active={picker}
              onPress={() => {
                if (!busy) setPicker((v) => !v);
              }}
            />
            {selected.map((id) => (
              <Chip
                key={id}
                label={`${records.find((r) => r.id === id)?.title || "记录"} ×`}
                onPress={() => {
                  if (!busy) setSelected((ids) => ids.filter((v) => v !== id));
                }}
              />
            ))}
          </View>
          {picker && (
            <View style={{ maxHeight: 180, gap: 8 }}>
              <Field
                label="查找参考记录"
                value={query}
                onChangeText={setQuery}
                placeholder="按标题查找"
              />
              <ScrollView
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {selectable.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    disabled={busy || r.dirty || !!r.conflict}
                    style={{ paddingVertical: 10 }}
                    onPress={() => {
                      if (selected.includes(r.id))
                        setSelected((ids) => ids.filter((id) => id !== r.id));
                      else if (selected.length < 3)
                        setSelected((ids) => [...ids, r.id]);
                      else setError("最多选择3条参考记录");
                    }}
                  >
                    <Text style={s.body}>
                      {selected.includes(r.id) ? "✓ " : "＋ "}
                      {r.title}
                      {r.dirty || r.conflict ? "（请先同步）" : ""}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
          <TextInput
            accessibilityLabel="向 AI 提问"
            value={message}
            onChangeText={setMessage}
            placeholder="输入问题，或选择上面的建议…"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={4000}
            editable={!busy && !blocked}
            style={[
              s.input,
              { maxHeight: 120, minHeight: 60, textAlignVertical: "top" },
            ]}
          />
          <Button
            title={busy ? "正在生成…" : "发送"}
            icon="arrow-up-outline"
            disabled={
              !status?.enabled || busy || loading || blocked || !message.trim()
            }
            onPress={() => void send()}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
