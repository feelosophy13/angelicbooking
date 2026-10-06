import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { api } from "@/lib/auth-client";

type Detail = { appointment: { id: string; status: string; notes: string | null }; client: { firstName: string; lastName: string; phone: string | null } | null; items: { id: string; serviceName: string; staffName: string; startAt: string; endAt: string; priceCents: number; status: string }[] };
const STATUSES = ["confirmed", "checked_in", "in_progress", "completed", "no_show", "cancelled"] as const;

export default function Appointment() {
  const { id, slug } = useLocalSearchParams<{ id: string; slug: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Detail>(`/api/mobile/appointments/${id}?slug=${slug}`).then(setD).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [id]);
  async function setStatus(status: string) {
    try {
      await api(`/api/mobile/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ slug, status }) });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!d) return <Text style={{ padding: 16 }}>{error ?? "Loading…"}</Text>;
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.name}>{d.client ? `${d.client.firstName} ${d.client.lastName}` : "Walk-in"}</Text>
      {d.client?.phone ? <Text style={s.sub}>{d.client.phone}</Text> : null}
      <Text style={s.status}>{d.appointment.status.replace("_", " ").toUpperCase()}</Text>
      {d.items.filter((i) => i.status !== "cancelled").map((i) => (
        <View key={i.id} style={s.item}>
          <Text style={{ fontWeight: "600" }}>{i.serviceName}</Text>
          <Text style={s.sub}>{time(i.startAt)} – {time(i.endAt)} · {i.staffName} · ${(i.priceCents / 100).toFixed(2)}</Text>
        </View>
      ))}
      {d.appointment.notes ? <Text style={s.notes}>{d.appointment.notes}</Text> : null}
      <View style={s.row}>
        {STATUSES.filter((x) => x !== d.appointment.status).map((x) => (
          <Pressable key={x} style={[s.btn, x === "cancelled" && { backgroundColor: "#dc2626" }]} onPress={() => setStatus(x)}>
            <Text style={s.btnText}>{x.replace("_", " ")}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={{ color: "#b91c1c" }}>{error}</Text> : null}
      <Pressable onPress={() => router.back()} style={{ padding: 12, alignItems: "center" }}><Text style={{ color: "#6d28d9" }}>Back to today</Text></Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 10 },
  name: { fontSize: 22, fontWeight: "600" },
  sub: { color: "#78716c" },
  status: { color: "#6d28d9", fontWeight: "600" },
  item: { padding: 12, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e7e5e4" },
  notes: { padding: 12, backgroundColor: "#fffbeb", borderRadius: 10, color: "#78350f" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  btn: { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#6d28d9", borderRadius: 10 },
  btnText: { color: "#fff", fontWeight: "600", textTransform: "capitalize" },
});
