import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useGarden } from "./context";
import { definitions, statusLabels } from "./definitions";
import type { LocalRecord } from "./data";
export const colors = {
  bg: "#F6F7F1",
  paper: "#FFFFFF",
  ink: "#243C30",
  muted: "#7A857C",
  green: "#3F7156",
  pale: "#E7EEE3",
  line: "#E2E7DE",
  red: "#A1473E",
  gold: "#A47B3F",
};
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 22, paddingBottom: 100, gap: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  between: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 29,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: -0.5,
  },
  subtitle: { fontSize: 14, lineHeight: 23, color: colors.muted },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    color: colors.green,
  },
  h2: { fontSize: 19, fontWeight: "700", color: colors.ink },
  body: { fontSize: 15, lineHeight: 25, color: colors.ink },
  card: {
    backgroundColor: colors.paper,
    borderRadius: 20,
    padding: 19,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.pale,
  },
  pillText: { fontSize: 12, color: colors.green, fontWeight: "600" },
  input: {
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
    paddingHorizontal: 15,
    paddingVertical: 13,
    color: colors.ink,
    fontSize: 16,
    minHeight: 49,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: 7,
  },
  button: {
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 15,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonText: { fontSize: 15, fontWeight: "600", color: "#FFF" },
  error: { color: colors.red, lineHeight: 23, fontSize: 13 },
  small: { fontSize: 12, lineHeight: 20, color: colors.muted },
  empty: { alignItems: "center", padding: 32, gap: 12 },
  divider: { height: 1, backgroundColor: colors.line },
});
export function Page({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
export function Header({
  title,
  subtitle,
  eyebrow = "STUDY HELPER",
  right,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8, marginTop: 12, marginBottom: 3 }}>
      <Text style={s.eyebrow}>{eyebrow}</Text>
      <View style={s.between}>
        <Text style={s.title}>{title}</Text>
        {right}
      </View>
      {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
    </View>
  );
}
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  icon,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[
        s.button,
        secondary && { backgroundColor: colors.pale },
        disabled && { opacity: 0.5 },
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={18}
          color={secondary ? colors.green : "#FFF"}
        />
      )}
      <Text style={[s.buttonText, secondary && { color: colors.green }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#A6ADA5"
        {...props}
        style={[s.input, props.style]}
      />
    </View>
  );
}
export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={[s.pill, active && { backgroundColor: colors.green }]}
    >
      <Text style={[s.pillText, active && { color: "#FFF" }]}>{label}</Text>
    </Pressable>
  );
}
export function Empty({
  title = "还没有记录",
  body = "先留下一件小事，让成长慢慢发生。",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <View style={s.empty}>
      <Ionicons name="leaf-outline" color={colors.green} size={35} />
      <Text style={s.h2}>{title}</Text>
      <Text style={[s.subtitle, { textAlign: "center" }]}>{body}</Text>
    </View>
  );
}
export function SyncLine() {
  const g = useGarden();
  const dirty = g.records.filter((r) => r.dirty).length;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push("/sync")}
      style={[s.row, { gap: 6 }]}
    >
      {g.busy ? (
        <ActivityIndicator size="small" color={colors.green} />
      ) : (
        <Ionicons
          name={
            g.syncError
              ? "cloud-offline-outline"
              : dirty
                ? "cloud-upload-outline"
                : "cloud-done-outline"
          }
          size={16}
          color={colors.green}
        />
      )}
      <Text style={s.small}>
        {g.busy
          ? "正在同步"
          : g.syncError
            ? "离线 · 本地记录可用"
            : dirty
              ? `${dirty} 条待同步`
              : "已同步"}
      </Text>
    </Pressable>
  );
}
export function RecordCard({ record }: { record: LocalRecord }) {
  const g = useGarden();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={record.title}
      onPress={() => router.push(`/records/${record.id}`)}
      style={s.card}
    >
      <View style={s.between}>
        <View style={s.row}>
          <Text style={s.pillText}>
            {definitions[record.kind]?.label || record.kind}
          </Text>
          <Text style={s.small}>
            {statusLabels[record.status] || record.status}
          </Text>
        </View>
        {record.conflict ? (
          <Text style={{ color: colors.red, fontSize: 12 }}>待处理冲突</Text>
        ) : record.dirty ? (
          <Ionicons name="cloud-upload-outline" size={15} color={colors.gold} />
        ) : null}
      </View>
      <Text style={[s.h2, g.large && { fontSize: 22 }]}>{record.title}</Text>
      {!!record.body && (
        <Text
          numberOfLines={2}
          style={[s.subtitle, g.large && { fontSize: 17 }]}
        >
          {record.body.replace(/[#*`]/g, "").slice(0, 160)}
        </Text>
      )}
      {!!record.tags.length && (
        <View style={[s.row, { flexWrap: "wrap" }]}>
          {record.tags.slice(0, 4).map((t) => (
            <Text key={t} style={s.small}>
              #{t}
            </Text>
          ))}
        </View>
      )}
    </Pressable>
  );
}
