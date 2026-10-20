import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../ui";
const icons: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  index: "sunny-outline",
  actions: "checkbox-outline",
  workspace: "grid-outline",
  notes: "document-text-outline",
  me: "person-outline",
};
export default function Layout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: "#929C92",
        tabBarStyle: { backgroundColor: "#FFF", borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarIcon: ({ color, size }) => (
          <Ionicons
            name={icons[route.name]}
            size={size}
            color={typeof color === "string" ? color : colors.green}
          />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: "今日" }} />
      <Tabs.Screen name="actions" options={{ title: "行动" }} />
      <Tabs.Screen name="workspace" options={{ title: "工作区" }} />
      <Tabs.Screen name="notes" options={{ title: "笔记" }} />
      <Tabs.Screen name="me" options={{ title: "我的" }} />
    </Tabs>
  );
}
