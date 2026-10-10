import { headers } from "next/headers";
import { requireAction } from "@/lib/tenant";
import { PageHeader, Tabs } from "@/components/ui";

export default async function MarketingLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "reports.view");
  const base = `/app/${slug}/marketing`;
  const h = await headers();
  const current = h.get("x-pathname") ?? "";
  const tab = current.startsWith(`${base}/automations`) ? `${base}/automations` : current.startsWith(`${base}/promos`) ? `${base}/promos` : base;
  return (
    <>
      <PageHeader title="Marketing" />
      <Tabs items={[{ href: base, label: "Campaigns" }, { href: `${base}/automations`, label: "Automations" }, { href: `${base}/promos`, label: "Promo codes" }]} current={tab} />
      {children}
    </>
  );
}
