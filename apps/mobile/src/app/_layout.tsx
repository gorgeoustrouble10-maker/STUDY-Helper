import { Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Provider, useGarden } from "../context";
import { colors } from "../ui";
function Navigation() {
  const { ready, session } = useGarden();
  if (!ready)
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.bg,
        }}
      >
        <ActivityIndicator color={colors.green} />
      </View>
    );
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="records/[id]" options={{ title: "记录详情" }} />
        <Stack.Screen
          name="edit"
          options={{ title: "编辑记录", presentation: "modal" }}
        />
        <Stack.Screen name="sync" options={{ title: "同步中心" }} />
        <Stack.Screen name="library" options={{ title: "更多记录" }} />
        <Stack.Screen name="ai" options={{ title: "AI 助手" }} />
      </Stack.Protected>
    </Stack>
  );
}
export default function Root() {
  return (
    <SafeAreaProvider>
      <Provider>
        <Navigation />
      </Provider>
    </SafeAreaProvider>
  );
}
