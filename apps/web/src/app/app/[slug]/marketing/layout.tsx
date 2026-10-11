import { headers } from "next/headers";
import { requireAction } from "@/lib/tenant";
import { PageHeader, Tabs } from "@/components/ui";

export default async function MarketingLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "reports.view");
  const base = `/app/${slug}/marketing`;
  const h = await headers();
  const current = h.get("x-pathname") ?? "";
  // Automations live in their own sidebar section; Marketing is campaigns and promo codes.
  if (current.startsWith(`${base}/automations`)) return <>{children}</>;
  const tab = current.startsWith(`${base}/promos`) ? `${base}/promos` : base;
  return (
    <>
      <PageHeader title="Marketing" />
      <Tabs items={[{ href: base, label: "Campaigns" }, { href: `${base}/promos`, label: "Promo codes" }]} current={tab} />
      {children}
    </>
  );
}
