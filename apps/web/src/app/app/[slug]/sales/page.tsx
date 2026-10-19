import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { zonedToInstant, instantToISODate } from "@angelic/core";
import { can } from "@angelic/core";
import { requireAnyAction } from "@/lib/tenant";
import { salesScope } from "@/lib/visibility";
import { listSales } from "@/server/sales";
import { listLocations } from "@/server/locations";
import { formatMoney, shiftISODate, cn } from "@/lib/utils";
import { Button, Card, Empty, Input, PageHeader, Select } from "@/components/ui";
import { Field } from "@/components/form";
import { LinkRow } from "@/components/table-row";
import { StatusBadge } from "@/components/status-badge";
import { ClientPicker } from "@/components/client-picker";
import { quickCreateClient } from "../clients/actions";

export const metadata: Metadata = { title: "Sales & checkout" };

type SP = { tab?: string; q?: string; page?: string };

export default async function SalesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  // Who sees which tickets is its own permission (M1): every ticket with sales.view.all, else the ones they are credited on
  // (sales.view.own, or taking payments alone). Starting a sale needs checkout.take.
  const { business, permissions, staffId, user } = await requireAnyAction(slug, "checkout.take", "sales.view.own", "sales.view.all");
  const scope = salesScope(permissions)!;
  const canSell = can(permissions, "checkout.take");
  const locations = await listLocations(business.id);
  const tab = sp.tab === "today" || sp.tab === "all" || sp.tab === "open" ? sp.tab : "open";
  const today = instantToISODate(new Date(), business.timezone);
  const filter = tab === "open" ? { status: "open" as const } : tab === "today" ? { status: "all" as const, from: zonedToInstant(today, "00:00", business.timezone), to: zonedToInstant(shiftISODate(today, 1), "00:00", business.timezone) } : { status: "all" as const };
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const { rows, total, pageSize } = await listSales(business.id, { ...filter, q: sp.q, page, ...(scope === "own" ? { own: { staffId, userId: user.id } } : {}) });
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });
  const money = (c: number) => formatMoney(c, business.currency);
  const href = (t: string, p = 1) => `?tab=${t}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}${p > 1 ? `&page=${p}` : ""}`;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <PageHeader title="Sales & checkout">
        {can(permissions, "reports.view") ? <Link href={`/app/${slug}/reports?from=${today}&to=${today}`} className="text-sm text-brand-700 underline">Today&apos;s report</Link> : null}
      </PageHeader>
      <div className={`mb-4 grid gap-4 ${canSell ? "lg:grid-cols-[1fr_360px]" : ""}`}>
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
              {([["open", "Open"], ["today", "Today"], ["all", "All"]] as const).map(([k, l]) => (
                <Link key={k} href={href(k)} className={cn("rounded-md px-3 py-1", tab === k ? "bg-stone-900 text-white" : "text-stone-700")}>{l}</Link>
              ))}
            </div>
            <form className="flex min-w-[16rem] flex-1 items-center gap-2">
              <input type="hidden" name="tab" value={tab} />
              <Input name="q" defaultValue={sp.q ?? ""} placeholder="Sale # or client name" className="min-w-0 flex-1 max-w-xs" />
              <Button type="submit" size="sm" variant="secondary">Search</Button>
            </form>
          </div>
        </Card>
        {canSell ? <Card className="p-3">
          {/* Opens the blank checkout; the ticket is saved only when its first item goes on. */}
          <form action={`/app/${slug}/sales/new`} className="space-y-2">
            <p className="text-sm font-medium">Sell a product or gift card</p>
            <ClientPicker slug={slug} initial={null} canCreate={can(permissions, "clients.write")} createClient={quickCreateClient} placeholder="Client (optional, blank for a walk-in)" />
            {locations.length > 1 ? (
              <Field label="Location" name="locationId">
                <Select name="locationId" defaultValue={locations.find((l) => l.isDefault)?.id ?? ""}>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
            ) : null}
            <Button type="submit" size="sm" className="w-full"><Plus className="h-4 w-4" /> Start sale</Button>
          </form>
        </Card> : null}
      </div>
      {rows.length === 0 ? (
        <Empty title={tab === "open" ? "No open tickets" : "No sales found"} body={tab === "open" ? "Check out an appointment from the calendar, or use Sell a product or gift card above." : undefined} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                <tr><th className="px-4 py-2">Sale</th><th className="px-4 py-2">Client</th><th className="px-4 py-2">When</th>{locations.length > 1 ? <th className="px-4 py-2">Location</th> : null}<th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2 text-right">Due</th><th className="px-4 py-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {rows.map(({ sale, clientFirst, clientLast, locationName }) => (
                  <LinkRow key={sale.id} href={`/app/${slug}/sales/${sale.id}`}>
                    <td className="px-4 py-2"><Link href={`/app/${slug}/sales/${sale.id}`} className="font-medium text-brand-700 hover:underline">#{sale.number}</Link></td>
                    <td className="px-4 py-2">{clientFirst || clientLast ? `${clientFirst ?? ""} ${clientLast ?? ""}`.trim() : <span className="text-stone-500">Walk-in</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-stone-600">{fmt.format(sale.closedAt ?? sale.createdAt)}</td>
                    {locations.length > 1 ? <td className="px-4 py-2 text-stone-600">{locationName ?? ""}</td> : null}
                    <td className="px-4 py-2 text-right">{money(sale.totalCents)}</td>
                    <td className="px-4 py-2 text-right">{sale.status === "open" && sale.totalCents - sale.paidCents > 0 ? money(sale.totalCents - sale.paidCents) : ""}</td>
                    <td className="px-4 py-2"><StatusBadge status={sale.status} /></td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-stone-200 px-4 py-2 text-sm text-stone-600">
              <span>{total} sales</span>
              <span className="flex gap-2">
                {page > 1 ? <Link href={href(tab, page - 1)} className="underline">Previous</Link> : null}
                {page < pages ? <Link href={href(tab, page + 1)} className="underline">Next</Link> : null}
              </span>
            </div>
          ) : null}
        </Card>
      )}
    </>
  );
}
