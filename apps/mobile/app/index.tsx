import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { authClient } from "@/lib/auth-client";

export default function SignIn() {
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) router.replace("/(app)");
  }, [session]);

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (r.error) setError(r.error.message ?? "Sign in failed");
  }

  if (isPending) return <ActivityIndicator style={{ flex: 1 }} />;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.wrap}>
      <Text style={s.title}>Angelic Booking</Text>
      <TextInput style={s.input} placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={s.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={s.btnText}>{busy ? "Signing in…" : "Sign in"}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: 24, gap: 12, backgroundColor: "#fafaf9" },
  title: { fontSize: 28, fontWeight: "600", textAlign: "center", marginBottom: 12 },
  input: { height: 48, borderWidth: 1, borderColor: "#d6d3d1", borderRadius: 10, paddingHorizontal: 12, backgroundColor: "#fff", fontSize: 16 },
  btn: { height: 48, borderRadius: 10, backgroundColor: "#6d28d9", alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  error: { color: "#b91c1c" },
});
