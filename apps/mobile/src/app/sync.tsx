import { Alert, Text, View } from "react-native";
import { useGarden } from "../context";
import { Button, Empty, Header, Page, colors, s } from "../ui";
export default function Screen() {
  const g = useGarden(),
    dirty = g.records.filter((r) => r.dirty),
    conflicts = g.records.filter((r) => r.conflict);
  return (
    <Page>
      <Header
        title="让记录，安心抵达。"
        eyebrow="CLOUD SYNC"
        subtitle="本地保存与云端同步是两个独立状态。"
      />
      <View style={s.card}>
        <Text style={s.h2}>
          {g.busy ? "正在同步…" : g.syncError ? "等待连接云端" : "云端连接正常"}
        </Text>
        <Text style={s.subtitle}>
          {dirty.length} 条待同步 · {conflicts.length} 条冲突
        </Text>
        <Text style={s.small}>最近同步：{g.lastSync || "本次尚未同步"}</Text>
        {!!g.syncError && <Text style={s.error}>{g.syncError}</Text>}
        <Button
          title={g.busy ? "同步中…" : "立即同步"}
          disabled={g.busy}
          icon="sync"
          onPress={() => void g.sync()}
        />
      </View>
      {conflicts.length > 0 && <Text style={s.h2}>需要比较的记录</Text>}
      {conflicts.map((r) => (
        <View key={r.id} style={s.card}>
          <Text style={s.h2}>{r.title}</Text>
          <Text style={s.label}>手机上的内容</Text>
          <Text selectable style={s.body}>
            {r.body || "（正文为空）"}
          </Text>
          <Text style={s.small}>
            {JSON.stringify(
              {
                status: r.status,
                fields: r.fields,
                tags: r.tags,
                links: r.links,
                deletedAt: r.deletedAt,
                archivedAt: r.archivedAt,
              },
              null,
              2,
            )}
          </Text>
          <View style={s.divider} />
          <Text style={s.label}>云端内容：{r.conflict?.title}</Text>
          <Text selectable style={s.body}>
            {r.conflict?.body || "（正文为空）"}
          </Text>
          <Text style={s.small}>
            {JSON.stringify(
              {
                status: r.conflict?.status,
                fields: r.conflict?.fields,
                tags: r.conflict?.tags,
                links: r.conflict?.links,
                deletedAt: r.conflict?.deletedAt,
                archivedAt: r.conflict?.archivedAt,
              },
              null,
              2,
            )}
          </Text>
          <Button
            title="保留手机内容并重新提交"
            onPress={() =>
              Alert.alert("确认使用手机内容", "将基于最新云端版本重新提交。", [
                { text: "取消", style: "cancel" },
                { text: "确认", onPress: () => g.resolve(r.id, true) },
              ])
            }
          />
          <Button
            title="采用云端内容"
            secondary
            onPress={() =>
              Alert.alert("确认采用云端内容", "手机上的冲突版本会被替换。", [
                { text: "取消", style: "cancel" },
                { text: "确认", onPress: () => g.resolve(r.id, false) },
              ])
            }
          />
        </View>
      ))}
      {!dirty.length && !conflicts.length && !g.syncError && (
        <Empty
          title="所有记录都已同步"
          body="继续记录，改变会在联网时送达云端。"
        />
      )}
      <Text style={[s.small, { color: colors.muted }]}>
        未同步记录仍在当前账号的手机副本中。网络恢复后可点击同步，或重新打开应用。
      </Text>
    </Page>
  );
}
