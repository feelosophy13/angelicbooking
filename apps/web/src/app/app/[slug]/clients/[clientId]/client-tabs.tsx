import { Tabs } from "@/components/tabs";

/** Profile and Charts for one client. The Charts tab is there only for someone who may read this client's charts. */
export function ClientTabs({ slug, clientId, charts }: { slug: string; clientId: string; charts: boolean }) {
  if (!charts) return null;
  const base = `/app/${slug}/clients/${clientId}`;
  return <Tabs items={[{ href: base, label: "Profile" }, { href: `${base}/charts`, label: "Charts" }]} />;
}
