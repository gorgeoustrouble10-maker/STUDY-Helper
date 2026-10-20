import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useGarden } from "../context";
import { blank, type RecordData } from "../data";
import { dateInput, dateToISO } from "../dates";
import {
  definitions,
  statusLabels,
  type Kind,
  type Field as Definition,
} from "../definitions";
import { Button, Chip, Field, Page, s } from "../ui";
export default function Editor() {
  const params = useLocalSearchParams<{
      id?: string;
      kind?: Kind;
      related?: string;
    }>(),
    g = useGarden();
  const kind = params.kind && params.kind in definitions ? params.kind : "NOTE";
  const key = params.id || `new:${kind}`;
  const [initial] = useState<RecordData>(
    () =>
      g.draft(key) ||
      g.records.find((r) => r.id === params.id) || {
        ...blank(kind),
        links: params.related
          ? [{ toId: params.related, relation: "related" }]
          : [],
      },
  );
  const [record, setRecord] = useState<RecordData>(initial),
    [error, setError] = useState(""),
    [tagText, setTagText] = useState(initial.tags.join("，")),
    [relationSearch, setRelationSearch] = useState("");
  const saved = useRef(false);
  const definition = definitions[record.kind];
  const touch = (values: Partial<RecordData>) => {
    setError("");
    setRecord((r) => ({ ...r, ...values }));
  };
  const { storeDraft } = g;
  useEffect(() => {
    if (!saved.current && (record.title || record.body))
      storeDraft(key, record);
  }, [record, key, storeDraft]);
  function fieldValue(field: Definition, value: unknown) {
    touch({ fields: { ...record.fields, [field.key]: value } });
  }
  function save() {
    if (!record.title.trim()) {
      setError("请填写标题");
      return;
    }
    const fields = { ...record.fields };
    for (const field of definition.fields) {
      const value = fields[field.key];
      if (field.type === "date") {
        try {
          fields[field.key] = dateToISO(value);
        } catch (e) {
          setError(`${field.label}：${(e as Error).message}`);
          return;
        }
        continue;
      }
      if (value === undefined || value === null || value === "") continue;
      if (field.type === "number" || field.type === "money") {
        const raw = String(value);
        if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
          setError(`${field.label}格式不正确`);
          return;
        }
        const n =
          field.type === "money" && typeof value === "string"
            ? Math.round(Number(raw) * 100)
            : Number(raw);
        if (!Number.isSafeInteger(n)) {
          setError(
            `${field.label}需为有效整数${field.type === "money" ? "金额" : ""}`,
          );
          return;
        }
        if (field.key === "estimatedMinutes" && n <= 0) {
          setError("预计用时须为正整数分钟，或留空");
          return;
        }
        fields[field.key] = n;
      }
    }
    if (
      record.kind === "TRANSACTION" &&
      (!fields.accountId || Number(fields.amountCents) <= 0)
    ) {
      setError("请选择账户并填写大于零的金额");
      return;
    }
    try {
      g.save({
        ...record,
        fields,
        tags: tagText
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
      });
      saved.current = true;
      g.clearDraft(key);
      router.back();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function renderField(field: Definition) {
    if (record.kind === "PUBLICATION" && field.key === "featured") return null;
    const value = record.fields[field.key];
    if (field.type === "checkbox")
      return (
        <View key={field.key} style={s.between}>
          <Text style={s.label}>{field.label}</Text>
          <Switch
            accessibilityLabel={field.label}
            value={!!value}
            onValueChange={(v) => fieldValue(field, v)}
          />
        </View>
      );
    if (field.type === "select")
      return (
        <View key={field.key}>
          <Text style={s.label}>{field.label}</Text>
          <View style={[s.row, { flexWrap: "wrap" }]}>
            {field.options?.map((option) => (
              <Chip
                key={option}
                label={statusLabels[option] || option}
                active={value === option}
                onPress={() => fieldValue(field, option)}
              />
            ))}
          </View>
        </View>
      );
    if (field.type === "account" || field.type === "record") {
      const rows = g.records.filter(
        (r) =>
          !r.deletedAt &&
          r.id !== record.id &&
          (field.type === "account"
            ? r.kind === "ACCOUNT"
            : r.kind === "ACTION"),
      );
      return (
        <View key={field.key}>
          <Text style={s.label}>{field.label}</Text>
          <View style={[s.row, { flexWrap: "wrap" }]}>
            <Chip
              label="不选择"
              active={!value}
              onPress={() => fieldValue(field, null)}
            />
            {rows.map((r) => (
              <Chip
                key={r.id}
                label={r.title}
                active={value === r.id}
                onPress={() => fieldValue(field, r.id)}
              />
            ))}
          </View>
        </View>
      );
    }
    const displayed =
      field.type === "money" && typeof value === "number"
        ? (value / 100).toFixed(2)
        : field.type === "date"
          ? dateInput(value)
          : String(value ?? "");
    return (
      <Field
        key={field.key}
        label={
          field.type === "date" ? `${field.label}（北京时间）` : field.label
        }
        value={displayed}
        onChangeText={(v) =>
          fieldValue(
            field,
            field.key === "estimatedMinutes" && v === "" ? null : v,
          )
        }
        multiline={field.type === "textarea"}
        keyboardType={
          field.type === "money" || field.type === "number"
            ? "decimal-pad"
            : "default"
        }
        placeholder={
          field.type === "date" ? "YYYY-MM-DD 或 YYYY-MM-DD HH:mm" : undefined
        }
        style={
          field.type === "textarea"
            ? { minHeight: 95, textAlignVertical: "top" }
            : undefined
        }
      />
    );
  }
  const links = g.records.filter(
    (r) =>
      r.id !== record.id &&
      !r.deletedAt &&
      `${r.title} ${definitions[r.kind].label}`.includes(relationSearch),
  );
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Page>
        <Text style={s.eyebrow}>{definition.label} · 保存后自动同步</Text>
        <Field
          label="标题"
          value={record.title}
          onChangeText={(v) => touch({ title: v })}
          maxLength={300}
          placeholder="给这条记录一个标题"
        />
        <View>
          <Text style={s.label}>状态</Text>
          <View style={[s.row, { flexWrap: "wrap" }]}>
            {definition.statuses
              .filter((v) => record.kind !== "PUBLICATION" || v === "DRAFT")
              .map((v) => (
                <Chip
                  key={v}
                  label={statusLabels[v]}
                  active={record.status === v}
                  onPress={() => touch({ status: v })}
                />
              ))}
          </View>
        </View>
        <Field
          label="正文"
          value={record.body}
          onChangeText={(v) => touch({ body: v })}
          multiline
          textAlignVertical="top"
          style={{ minHeight: 220 }}
          placeholder="写下想法、过程或下一步。支持保存 Markdown 源文本。"
        />
        <Field
          label="标签"
          value={tagText}
          onChangeText={(v) => {
            setTagText(v);
            touch({
              tags: v
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean),
            });
          }}
          placeholder="学习，实践，生活"
        />
        {definition.fields.map(renderField)}
        <View style={s.card}>
          <Text style={s.h2}>关联记录</Text>
          <Field
            label="查找关联对象"
            value={relationSearch}
            onChangeText={setRelationSearch}
            placeholder="输入标题或类型"
          />
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {links.slice(0, 30).map((r) => (
              <Chip
                key={r.id}
                label={r.title}
                active={record.links.some((l) => l.toId === r.id)}
                onPress={() =>
                  touch({
                    links: record.links.some((l) => l.toId === r.id)
                      ? record.links.filter((l) => l.toId !== r.id)
                      : [...record.links, { toId: r.id, relation: "related" }],
                  })
                }
              />
            ))}
          </ScrollView>
          {!links.length && (
            <Text style={s.small}>创建其他记录后，可在这里建立关联。</Text>
          )}
        </View>
        {record.kind === "PUBLICATION" && (
          <Text style={s.small}>
            此处保存的是私密公开稿草稿。试用版尚未提供对外发布操作。
          </Text>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        )}
        <Button title="保存记录" icon="checkmark" onPress={save} />
        <Button
          title="放弃这份编辑草稿"
          secondary
          onPress={() =>
            Alert.alert("放弃编辑草稿", "已保存的记录不会被删除。", [
              { text: "取消", style: "cancel" },
              {
                text: "放弃草稿",
                style: "destructive",
                onPress: () => {
                  saved.current = true;
                  g.clearDraft(key);
                  router.back();
                },
              },
            ])
          }
        />
        <Text style={s.small}>
          编辑草稿保存在当前账号的手机数据库中；点击保存后进入同步队列。
        </Text>
      </Page>
    </KeyboardAvoidingView>
  );
}
