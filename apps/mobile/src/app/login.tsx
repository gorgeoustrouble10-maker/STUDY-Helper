import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useGarden } from "../context";
import { Button, Chip, Field, Page, colors, s } from "../ui";
export default function Login() {
  const g = useGarden();
  const [register, setRegister] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [invite, setInvite] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit() {
    setError("");
    if (!username.trim() || !password) {
      setError("请填写账号和密码");
      return;
    }
    if (register && password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    if (register && !invite) {
      setError("请输入邀请码");
      return;
    }
    setBusy(true);
    try {
      await g.login(username.trim(), password, register ? invite : undefined);
      setPassword("");
      setConfirm("");
      setInvite("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Page>
          <View style={{ paddingTop: 35, paddingBottom: 24, gap: 18 }}>
            <View
              style={{
                width: 66,
                height: 66,
                borderRadius: 22,
                backgroundColor: colors.pale,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="leaf-outline" size={34} color={colors.green} />
            </View>
            <Text style={s.eyebrow}>YOUR SPACE TO GROW</Text>
            <Text style={[s.title, { fontSize: 35, lineHeight: 47 }]}>
              记录当下，{"\n"}让成长有迹可循。
            </Text>
            <Text style={s.subtitle}>学习、行动和生活，都有自己的位置。</Text>
          </View>
          <View style={s.row}>
            <Chip
              label="登录"
              active={!register}
              onPress={() => {
                setRegister(false);
                setError("");
              }}
            />
            <Chip
              label="邀请码注册"
              active={register}
              onPress={() => {
                setRegister(true);
                setError("");
              }}
            />
          </View>
          <View style={[s.card, { gap: 18 }]}>
            <Field
              label="账号"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={40}
              placeholder="3–40 位字母、数字或下划线"
              autoComplete="username"
            />
            <Field
              label="密码"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              maxLength={200}
              placeholder="至少 10 位"
              autoComplete={register ? "new-password" : "current-password"}
            />
            {register && (
              <>
                <Field
                  label="确认密码"
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry
                  autoComplete="new-password"
                />
                <Field
                  label="邀请码"
                  value={invite}
                  onChangeText={setInvite}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="请输入邀请人提供的邀请码"
                  maxLength={100}
                />
              </>
            )}
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
            <Button
              title={
                busy
                  ? "正在连接云端…"
                  : register
                    ? "注册并进入"
                    : "进入我的工作台"
              }
              onPress={() => void submit()}
              disabled={busy}
              icon="arrow-forward"
            />
          </View>
          <Text style={[s.small, { textAlign: "center", paddingTop: 12 }]}>
            账号与记录由云端保存，手机保留离线副本。{"\n"}
            首次注册和登录需要网络连接。
          </Text>
        </Page>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
