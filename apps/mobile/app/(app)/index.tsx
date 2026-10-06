import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { api, authClient } from "@/lib/auth-client";

type Me = { user: { name: string }; businesses: { slug: string; name: string; timezone: string }[] };
type Agenda = { date: string; timezone: string; staff: { id: string; name: string; color: string }[]; items: { id: string; appointmentId: string; staffId: string; serviceName: string; startAt: string; endAt: string; status: string; clientName: string | null }[] };

const shift = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);

export default function Today() {
  const [me, setMe] = useState<Me | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const m = me ?? (await api<Me>("/api/mobile/me"));
      if (!me) setMe(m);
      const s = slug ?? m.businesses[0]?.slug ?? null;
      if (!slug) setSlug(s);
      if (!s) return;
      const a = await api<Agenda>(`/api/mobile/agenda?slug=${s}${date ? `&date=${date}` : ""}`);
      setAgenda(a);
      if (!date) setDate(a.date);
    } catch (e) {
      setError((e as Error).message);
      if ((e as Error).message === "unauthorized") router.replace("/");
    }
  }, [me, slug, date]);

  useEffect(() => {
    load();
  }, [load]);

  const time = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: agenda?.timezone }).format(new Date(iso));
  const staffName = (id: string) => agenda?.staff.find((s) => s.id === id)?.name ?? "";
  const items = (agenda?.items ?? []).slice().sort((a, b) => a.startAt.localeCompare(b.startAt));

  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        <Pressable onPress={() => date && setDate(shift(date, -1))}><Text style={s.nav}>‹</Text></Pressable>
        <Text style={s.date}>{date ? new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "…"}</Text>
        <Pressable onPress={() => date && setDate(shift(date, 1))}><Text style={s.nav}>›</Text></Pressable>
      </View>
      {me?.businesses.length ? <Text style={s.biz}>{me.businesses.find((b) => b.slug === slug)?.name}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<Text style={s.empty}>{agenda ? "No appointments." : "Loading…"}</Text>}
        renderItem={({ item }) => (
          <Pressable style={[s.card, item.status === "cancelled" && { opacity: 0.5 }]} onPress={() => router.push({ pathname: "/(app)/appointment/[id]", params: { id: item.appointmentId, slug: slug ?? "" } })}>
            <View style={[s.dot, { backgroundColor: agenda?.staff.find((x) => x.id === item.staffId)?.color ?? "#6366f1" }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{item.clientName ?? "Walk-in"} · {item.serviceName}</Text>
              <Text style={s.cardSub}>{time(item.startAt)} – {time(item.endAt)} · {staffName(item.staffId)} · {item.status.replace("_", " ")}</Text>
            </View>
          </Pressable>
        )}
      />
      <Pressable style={s.signout} onPress={async () => { await authClient.signOut(); router.replace("/"); }}><Text style={{ color: "#78716c" }}>Sign out</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#fafaf9", padding: 16 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nav: { fontSize: 28, paddingHorizontal: 12, color: "#6d28d9" },
  date: { fontSize: 18, fontWeight: "600" },
  biz: { textAlign: "center", color: "#78716c", marginBottom: 8 },
  card: { flexDirection: "row", gap: 10, padding: 12, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e7e5e4", marginBottom: 8, alignItems: "center" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { fontWeight: "600" },
  cardSub: { color: "#78716c", fontSize: 13 },
  empty: { textAlign: "center", color: "#78716c", marginTop: 40 },
  error: { color: "#b91c1c", textAlign: "center" },
  signout: { alignItems: "center", padding: 12 },
});
