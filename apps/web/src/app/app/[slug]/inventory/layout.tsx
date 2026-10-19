import { headers } from "next/headers";
import type { Metadata } from "next";
import { can } from "@angelic/core";
import { requireBusiness, requireAction } from "@/lib/tenant";
import { PageHeader, Tabs } from "@/components/ui";

export const metadata: Metadata = { title: "Inventory" };

/** Inventory's pages share a header and tabs: stock, what to reorder, orders to suppliers, suppliers, counting and the report. */
export default async function InventoryLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Managing stock sees every tab; "See stock levels" gets Stock and History read-only; someone who only logs supplies sees just that
  // page. Each page checks its own permission.
  const { permissions } = await requireBusiness(slug);
  const manage = can(permissions, "inventory.manage");
  const view = can(permissions, "inventory.view");
  if (!manage && !view) await requireAction(slug, "inventory.log");
  const base = `/app/${slug}/inventory`;
  const tabs = !manage ? [
    ...(view ? [{ href: base, label: "Stock" }] : []),
    ...(can(permissions, "inventory.log") ? [{ href: `${base}/use`, label: "Log usage" }] : []),
    ...(view ? [{ href: `${base}/history`, label: "History" }] : []),
  ] : [
    { href: base, label: "Stock" },
    { href: `${base}/reorder`, label: "Reorder" },
    { href: `${base}/orders`, label: "Orders" },
    { href: `${base}/suppliers`, label: "Suppliers" },
    { href: `${base}/use`, label: "Log usage" },
    { href: `${base}/count`, label: "Count" },
    { href: `${base}/history`, label: "History" },
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
