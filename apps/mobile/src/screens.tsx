import { useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useGarden } from "./context";
import { definitions, statusLabels, type Kind } from "./definitions";
import {
  Button,
  Chip,
  Empty,
  Header,
  Page,
  RecordCard,
  SyncLine,
  colors,
  s,
} from "./ui";
const newRecord = (kind: Kind) =>
  router.push({ pathname: "/edit", params: { kind } });
export function Today() {
  const g = useGarden();
  const all = g.records.filter((r) => !r.deletedAt && !r.archivedAt),
    actions = all.filter((r) => r.kind === "ACTION" && r.status !== "DONE"),
    focus = actions.filter((r) => r.fields.todayFocus);
  return (
    <SafeAreaView edges={["top"]} style={s.screen}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={g.busy}
            onRefresh={() => void g.sync()}
            tintColor={colors.green}
          />
        }
      >
        <Header
          title="今天，从一件小事开始。"
          eyebrow={new Date().toLocaleDateString("zh-CN", {
            timeZone: "Asia/Shanghai",
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
          subtitle="选好下一步，让重要的事慢慢向前。"
        />
        <SyncLine />
        <View
          style={[
            s.card,
            {
              backgroundColor: colors.ink,
              borderColor: colors.ink,
              padding: 25,
              gap: 16,
            },
          ]}
        >
          <View style={s.between}>
            <Text style={{ color: "#BED4BD", letterSpacing: 2, fontSize: 11 }}>
              A LITTLE PROGRESS, EVERY DAY
            </Text>
            <Ionicons name="sunny-outline" size={25} color="#D3DCB4" />
          </View>
          <Text
            style={{
              fontSize: 25,
              lineHeight: 36,
              color: "#F8F9EB",
              fontWeight: "600",
            }}
          >
            留一点空间，{"\n"}做重要的事。
          </Text>
          <View style={[s.row, { gap: 30 }]}>
            <View>
              <Text style={{ fontSize: 32, color: "#FFF", fontWeight: "700" }}>
                {actions.length}
              </Text>
              <Text style={{ fontSize: 12, color: "#C4D2C5" }}>待推进行动</Text>
            </View>
            <View>
              <Text style={{ fontSize: 32, color: "#FFF", fontWeight: "700" }}>
                {
                  all.filter((r) => r.kind === "NOTE" && r.status === "INBOX")
                    .length
                }
              </Text>
              <Text style={{ fontSize: 12, color: "#C4D2C5" }}>收件箱记录</Text>
            </View>
          </View>
        </View>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Button
              title="快速记录"
              secondary
              icon="create-outline"
              onPress={() => newRecord("NOTE")}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="安排一个行动"
              icon="add"
              onPress={() => newRecord("ACTION")}
            />
          </View>
        </View>
        <Text style={s.h2}>今日重点</Text>
        {focus.length ? (
          focus.map((r) => <RecordCard key={r.id} record={r} />)
        ) : (
          <View style={s.card}>
            <Text style={s.subtitle}>
              在行动编辑页勾选“今日重点”，从一至三件事开始。
            </Text>
          </View>
        )}
        <View style={s.between}>
          <Text style={s.h2}>最近的记录</Text>
          <Pressable onPress={() => router.push("/(tabs)/notes")}>
            <Text style={s.pillText}>查看全部 →</Text>
          </Pressable>
        </View>
        {all.length ? (
          all.slice(0, 4).map((r) => <RecordCard key={r.id} record={r} />)
        ) : (
          <Empty
            title="你的花园，从这里开始"
            body="写下一条笔记，或安排第一个行动。"
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
export function Records({
  mode,
}: {
  mode: "actions" | "workspace" | "notes" | "library";
}) {
  const g = useGarden();
  const [q, setQ] = useState(""),
    [filter, setFilter] = useState("全部");
  const options =
    mode === "actions"
      ? ["全部", "待开始", "进行中", "已完成"]
      : mode === "workspace"
        ? ["全部", "项目", "课程", "领域"]
        : mode === "notes"
          ? ["全部", "收件箱", "笔记", "资源"]
          : [
              "全部",
              "问题",
              "复盘",
              "人物",
              "物品",
              "账户",
              "收支",
              "预算",
              "公开稿",
              "渠道稿件",
              "归档",
              "回收站",
            ];
  const kinds: Kind[] =
    mode === "actions"
      ? ["ACTION"]
      : mode === "workspace"
        ? ["PROJECT", "COURSE", "DOMAIN"]
        : mode === "notes"
          ? ["NOTE", "RESOURCE"]
          : [
              "ISSUE",
              "REVIEW",
              "PERSON",
              "ITEM",
              "ACCOUNT",
              "TRANSACTION",
              "BUDGET",
              "PUBLICATION",
              "CHANNEL",
            ];
  const title =
    mode === "actions"
      ? "把想法，落到行动。"
      : mode === "workspace"
        ? "围绕目标，积累成果。"
        : mode === "notes"
          ? "先留下，再慢慢整理。"
          : "生活的其他部分";
  const rows = g.records
    .filter((r) =>
      filter === "回收站"
        ? !!r.deletedAt
        : filter === "归档"
          ? !!r.archivedAt && !r.deletedAt
          : !r.deletedAt && !r.archivedAt && kinds.includes(r.kind),
    )
    .filter(
      (r) =>
        !q ||
        `${r.title} ${r.body} ${r.tags.join(" ")}`
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    .filter(
      (r) =>
        ["全部", "归档", "回收站"].includes(filter) ||
        (filter === "收件箱" && r.kind === "NOTE" && r.status === "INBOX") ||
        definitions[r.kind].label === filter ||
        (mode === "actions" && statusLabels[r.status] === filter),
    );
  const [count, setCount] = useState(30);
  return (
    <SafeAreaView edges={["top"]} style={s.screen}>
      <Page>
        <Header
          title={title}
          eyebrow={
            mode === "actions"
              ? "NEXT SMALL STEP"
              : mode === "workspace"
                ? "PROJECTS & LEARNING"
                : "CAPTURE & CONNECT"
          }
        />
        <SyncLine />
        <TextInput
          accessibilityLabel="搜索记录"
          style={s.input}
          value={q}
          onChangeText={(v) => {
            setQ(v);
            setCount(30);
          }}
          placeholder="搜索标题、正文或标签…"
          placeholderTextColor={colors.muted}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {options.map((f) => (
            <Chip
              key={f}
              label={f}
              active={filter === f}
              onPress={() => {
                setFilter(f);
                setCount(30);
              }}
            />
          ))}
        </ScrollView>
        <View style={[s.row, { flexWrap: "wrap" }]}>
          {kinds.map((kind) => (
            <Chip
              key={kind}
              label={`＋ ${definitions[kind].label}`}
              onPress={() => newRecord(kind)}
            />
          ))}
        </View>
        <Text style={s.small}>共 {rows.length} 条记录</Text>
        {rows.length ? (
          rows.slice(0, count).map((r) => <RecordCard key={r.id} record={r} />)
        ) : (
          <Empty />
        )}
        {count < rows.length && (
          <Button
            title="加载更多"
            secondary
            onPress={() => setCount((v) => v + 30)}
          />
        )}
      </Page>
    </SafeAreaView>
  );
}
export function Me() {
  const g = useGarden();
  const pending = g.records.filter((r) => r.dirty).length;
  function logout() {
    Alert.alert(
      "退出当前账号",
      pending
        ? `还有 ${pending} 条记录未同步，将保留在当前账号的手机副本中，重新登录后可继续同步。`
        : "已同步数据保留在云端，本机副本按账号隔离。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "退出登录",
          onPress: () => {
            void g
              .logout()
              .catch((e) => Alert.alert("暂时无法退出", e.message));
          },
        },
      ],
    );
  }
  return (
    <SafeAreaView edges={["top"]} style={s.screen}>
      <Page>
        <Header title="照顾好自己的节奏。" eyebrow="MY GARDEN" />
        <View style={s.card}>
          <View style={s.row}>
            <View
              style={{
                padding: 15,
                borderRadius: 22,
                backgroundColor: colors.pale,
              }}
            >
              <Ionicons name="person-outline" size={25} color={colors.green} />
            </View>
            <View>
              <Text style={s.h2}>{g.session?.user.username}</Text>
              <Text style={s.small}>个人数字花园 · 0.2.0</Text>
            </View>
          </View>
          <SyncLine />
        </View>
        <Button
          title="同步中心"
          secondary
          icon="sync-outline"
          onPress={() => router.push("/sync")}
        />
        <Button
          title="AI 助手"
          secondary
          icon="sparkles-outline"
          onPress={() => router.push("/ai")}
        />
        <Button
          title="问题、复盘与更多记录"
          secondary
          icon="grid-outline"
          onPress={() => router.push("/library")}
        />
        <View style={s.card}>
          <Text style={s.h2}>设备偏好</Text>
          <View style={s.between}>
            <View>
              <Text style={s.body}>放大记录文字</Text>
              <Text style={s.small}>仅保存在这台设备</Text>
            </View>
            <Switch
              accessibilityLabel="放大记录文字"
              value={g.large}
              onValueChange={g.setLarge}
              trackColor={{ true: colors.green }}
            />
          </View>
        </View>
        <View style={s.card}>
          <Text style={s.h2}>关于数据</Text>
          <Text style={s.subtitle}>
            业务记录同步到云端，手机保存离线副本。未同步修改会留在手机上；卸载应用前，请先完成同步。
          </Text>
          <Text style={s.small}>
            当前移动试用版的数据独立于旧网页工作台；旧数据尚未迁入。
          </Text>
        </View>
        <Button
          title="退出登录"
          secondary
          icon="log-out-outline"
          disabled={g.busy}
          onPress={logout}
        />
      </Page>
    </SafeAreaView>
  );
}
