import { headers } from "next/headers";
import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { PageHeader, Tabs } from "@/components/ui";

export const metadata: Metadata = { title: "Inventory" };

/** Inventory's pages share a header and tabs: stock, what to reorder, orders to suppliers, suppliers, counting and the report. */
export default async function InventoryLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "inventory.manage");
  const base = `/app/${slug}/inventory`;
  const tabs = [
    { href: base, label: "Stock" },
    { href: `${base}/reorder`, label: "Reorder" },
    { href: `${base}/orders`, label: "Orders" },
    { href: `${base}/suppliers`, label: "Suppliers" },
    { href: `${base}/count`, label: "Count" },
    { href: `${base}/report`, label: "Report" },
  ];
  const current = (await headers()).get("x-pathname") ?? "";
  return (
    <>
      <PageHeader title="Inventory" />
      <Tabs items={tabs} current={current} />
      {children}
    </>
  );
}
