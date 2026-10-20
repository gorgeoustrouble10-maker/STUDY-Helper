import { Alert, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useGarden } from "../../context";
import { definitions, statusLabels } from "../../definitions";
import { Button, Chip, Empty, Header, Page, RecordCard, s } from "../../ui";
import Markdown from "../../components/Markdown";
export default function Detail() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    g = useGarden();
  const r = g.records.find((v) => v.id === id);
  if (!r)
    return (
      <Page>
        <Empty title="没有找到这条记录" />
      </Page>
    );
  const definition = definitions[r.kind];
  const related = g.records.filter(
    (v) =>
      !v.deletedAt &&
      (r.links.some((l) => l.toId === v.id) ||
        v.links.some((l) => l.toId === r.id)),
  );
  function remove() {
    Alert.alert("移入回收站", r!.title, [
      { text: "取消", style: "cancel" },
      {
        text: "移入回收站",
        style: "destructive",
        onPress: () => {
          g.save({ ...r!, deletedAt: new Date().toISOString() });
          router.back();
        },
      },
    ]);
  }
  return (
    <Page>
      <Header
        title={r.title}
        eyebrow={`${definition.label} · ${statusLabels[r.status] || r.status}`}
        subtitle={
          r.conflict
            ? "有版本冲突，请前往同步中心处理"
            : r.dirty
              ? "已保存到手机，等待云端确认"
              : "已同步云端"
        }
      />
      {r.conflict && (
        <Button
          title="查看冲突"
          secondary
          onPress={() => router.push("/sync")}
        />
      )}
      <View style={[s.row, { flexWrap: "wrap" }]}>
        {r.tags.map((t) => (
          <Chip key={t} label={`# ${t}`} />
        ))}
      </View>
      <View style={s.card}>
        <Markdown
          body={r.body || "还没有正文，可以编辑并留下第一段记录。"}
          large={g.large}
        />
      </View>
      {definition.fields
        .filter(
          (f) =>
            r.fields[f.key] !== undefined &&
            r.fields[f.key] !== "" &&
            r.fields[f.key] !== null,
        )
        .map((f) => (
          <View key={f.key} style={s.card}>
            <Text style={s.label}>{f.label}</Text>
            <Text selectable style={s.body}>
              {f.type === "money"
                ? `¥ ${(Number(r.fields[f.key]) / 100).toFixed(2)}`
                : typeof r.fields[f.key] === "boolean"
                  ? r.fields[f.key]
                    ? "是"
                    : "否"
                  : statusLabels[String(r.fields[f.key])] ||
                    String(r.fields[f.key])}
            </Text>
          </View>
        ))}
      <Button
        title="用 AI 分析这条记录"
        secondary
        icon="sparkles-outline"
        disabled={!!r.deletedAt || !!r.archivedAt}
        onPress={() =>
          router.push({ pathname: "/ai", params: { recordId: r.id } })
        }
      />
      <Button
        title="编辑记录"
        icon="create-outline"
        onPress={() => router.push({ pathname: "/edit", params: { id: r.id } })}
      />
      {r.kind === "ACTION" && !r.deletedAt && (
        <Button
          title={r.status === "DONE" ? "重新打开" : "完成行动"}
          secondary
          icon="checkmark-circle-outline"
          onPress={() =>
            g.save({ ...r, status: r.status === "DONE" ? "TODO" : "DONE" })
          }
        />
      )}
      <Button
        title="建立关联行动"
        secondary
        onPress={() =>
          router.push({
            pathname: "/edit",
            params: { kind: "ACTION", related: r.id },
          })
        }
      />
      {related.length > 0 && <Text style={s.h2}>关联记录</Text>}
      {related.map((v) => (
        <RecordCard key={v.id} record={v} />
      ))}
      <View style={s.divider} />
      {r.deletedAt ? (
        <Button
          title="从回收站恢复"
          secondary
          onPress={() => g.save({ ...r, deletedAt: null })}
        />
      ) : (
        <>
          <Button
            title={r.archivedAt ? "移出归档" : "归档记录"}
            secondary
            onPress={() =>
              g.save({
                ...r,
                archivedAt: r.archivedAt ? null : new Date().toISOString(),
              })
            }
          />
          <Button title="移入回收站" secondary onPress={remove} />
        </>
      )}
      <Text style={s.small}>
        创建于{" "}
        {new Date(r.createdAt).toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
        })}
      </Text>
    </Page>
  );
}
