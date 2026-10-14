import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAction } from "@/lib/tenant";
import { listPurchaseOrders } from "@/server/inventory";
import { dateLong } from "@/lib/format";
import { formatMoney } from "@/lib/utils";
import { Card, Empty, LinkButton } from "@/components/ui";
import { rowClass, RowLink } from "@/components/row";
import { StatusPill } from "./status-pill";

export const metadata: Metadata = { title: "Orders · Inventory" };

export default async function OrdersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ show?: string }> }) {
  const { slug } = await params;
  const { show } = await searchParams;
  const { business } = await requireAction(slug, "inventory.manage");
  const closed = show === "closed";
  const orders = await listPurchaseOrders(business.id, closed ? "received" : "open");
  const base = `/app/${slug}/inventory/orders`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="Which orders">
          <Link href={base} aria-current={!closed ? "true" : undefined} className={`rounded-md px-3 py-0.5 ${!closed ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50"}`}>Open</Link>
          <Link href={`${base}?show=closed`} aria-current={closed ? "true" : undefined} className={`rounded-md px-3 py-0.5 ${closed ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50"}`}>Received &amp; cancelled</Link>
        </div>
        <LinkButton href={`${base}/new`} variant="primary" size="sm"><Plus className="h-4 w-4" /> New order</LinkButton>
      </div>
      {orders.length === 0 ? (
        <Empty title={closed ? "Nothing here yet" : "No open orders"} body={closed ? undefined : "Orders to your suppliers show here from the moment you draft them until everything has arrived."} action={closed ? undefined : { href: `/app/${slug}/inventory/reorder`, label: "See what to reorder" }} />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {orders.map((o) => (
              <li key={o.id} className={`${rowClass} flex items-center gap-3 px-4 py-3`}>
                <div className="min-w-0 flex-1">
                  <RowLink href={`${base}/${o.id}`} className="font-medium">Order #{o.number}{o.supplier ? ` · ${o.supplier}` : ""}</RowLink>
                  <p className="text-xs text-stone-500">{o.units} unit{o.units === 1 ? "" : "s"}{o.status === "partial" ? ` · ${o.receivedUnits} received` : ""}{o.expectedOn ? ` · expected ${dateLong(o.expectedOn)}` : ""}</p>
                </div>
                <StatusPill status={o.status} />
                <span className="w-24 shrink-0 text-right text-sm tabular-nums text-stone-600">{o.costCents ? formatMoney(o.costCents, business.currency) : "—"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
