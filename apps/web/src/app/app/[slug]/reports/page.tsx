import Link from "next/link";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { Download } from "lucide-react";

export const metadata: Metadata = { title: "Sales" };
import { can, instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { salesReport } from "@/server/sales";
import { stockReport } from "@/server/inventory";
import { formatDateLong, formatMoney, shiftISODate } from "@/lib/utils";
import { Button, Card, Input, PageHeader, Empty, LinkButton } from "@/components/ui";
import { LocationFilter } from "@/components/location-filter";
import { listLocations } from "@/server/locations";

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; location?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireAction(slug, "reports.view");
  const locations = await listLocations(business.id);
  const locationFilter = locations.some((l) => l.id === sp.location) ? sp.location! : null;
  const locName = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "Unknown") : "No location");
  const lq = locationFilter ? `&location=${locationFilter}` : "";
  const tz = business.timezone;
  const today = instantToISODate(new Date(), tz);
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(sp.from) ? sp.from! : today;
  const to = isDate(sp.to) ? sp.to! : from;
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
  const prevFrom = shiftISODate(from, -days);
  const prevTo = shiftISODate(from, -1);
  const isPreset = (from === today && to === today) || (from === shiftISODate(today, -6) && to === today) || (from === `${today.slice(0, 8)}01` && to === today);
  const stock = await stockReport(business.id);
  const [{ sales, byStaff, byMethod, byService, appts, byLocation, crossLocation }, prev] = await Promise.all([
    salesReport(business.id, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz), locationFilter),
    salesReport(business.id, zonedToInstant(prevFrom, "00:00", tz), zonedToInstant(from, "00:00", tz), locationFilter),
  ]);
  const money = (c: number) => formatMoney(Number(c), business.currency);
  type K = "subtotalCents" | "discountCents" | "taxCents" | "tipCents" | "totalCents" | "refundedCents";
  const sum = (k: K, rows = sales) => rows.reduce((s, r) => s + r[k], 0);
  const delta = (cur: number, before: number) => {
    if (before === 0) return cur === 0 ? null : { pct: null, up: cur > 0 };
    const pct = Math.round(((cur - before) / before) * 100);
    return { pct, up: pct >= 0 };
  };
  const periodLabel = days === 1 ? "previous day" : `previous ${days} days`;
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short", timeZone: tz });

  return (
    <>
      <PageHeader title="Reports">
        <LocationFilter locations={locations} current={locationFilter} query={`from=${from}&to=${to}`} allLabel="All" />
        <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="Period">
          {(
            [
              ["Today", today, today],
              ["7 days", shiftISODate(today, -6), today],
              ["This month", `${today.slice(0, 8)}01`, today],
            ] as const
          ).map(([label, f, t]) => (
            <Link key={label} href={`?from=${f}&to=${t}${lq}`} className={`rounded-md px-3 py-1 ${from === f && to === t ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50"}`}>{label}</Link>
          ))}
          <details className="relative">
            <summary className={`cursor-pointer select-none rounded-md px-3 py-1 marker:content-none [&::-webkit-details-marker]:hidden ${isPreset ? "text-stone-700 hover:bg-stone-50" : "bg-stone-900 text-white"}`}>Custom</summary>
            <form className="absolute right-0 z-20 mt-1 flex w-max items-center gap-2 rounded-lg border border-stone-200 bg-white p-3 shadow-lg">
              <Input type="date" name="from" defaultValue={from} className="w-40" aria-label="From" />
              <span className="text-sm text-stone-500">to</span>
              <Input type="date" name="to" defaultValue={to} className="w-40" aria-label="To" />
              {locationFilter ? <input type="hidden" name="location" value={locationFilter} /> : null}
              <Button type="submit" variant="secondary" size="sm">Show</Button>
            </form>
          </details>
        </div>
        <LinkButton href={`?from=${prevFrom}&to=${prevTo}${lq}`} size="sm" variant="ghost" aria-label="Previous period">‹ Prior period</LinkButton>
        <details className="relative">
          <summary className="flex cursor-pointer select-none items-center gap-1 rounded-lg px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 marker:content-none [&::-webkit-details-marker]:hidden"><Download className="h-4 w-4" /> Export</summary>
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-lg">
            <a href={`/app/${slug}/reports/export?kind=sales&from=${from}&to=${to}${lq}`} className="block px-3 py-1.5 hover:bg-stone-50">Sales (CSV)</a>
            <a href={`/app/${slug}/reports/export?kind=appointments&from=${from}&to=${to}${lq}`} className="block px-3 py-1.5 hover:bg-stone-50">Appointments (CSV)</a>
          </div>
        </details>
      </PageHeader>
      <p className="mb-4 text-sm text-stone-600">{from === to ? formatDateLong(from) : `${formatDateLong(from)} – ${formatDateLong(to)}`}{locationFilter ? ` · ${locName(locationFilter)}` : ""}</p>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(
          [
            ["Sales", sum("totalCents") - sum("tipCents"), sum("totalCents", prev.sales) - sum("tipCents", prev.sales), true],
            ["Tips", sum("tipCents"), sum("tipCents", prev.sales), true],
            ["Discounts", sum("discountCents"), sum("discountCents", prev.sales), false],
            ["Tax collected", sum("taxCents"), sum("taxCents", prev.sales), true],
            ["Refunds", sum("refundedCents"), sum("refundedCents", prev.sales), false],
          ] as [string, number, number, boolean][]
        ).map(([label, v, before, goodUp]) => {
          const d = delta(v, before);
          const positive = d ? d.up === goodUp : null;
          return (
            <Card key={label} className="p-4">
              <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
              <p className="text-xl font-semibold">{money(v)}</p>
              {d ? (
                <p className={`mt-1 text-xs ${positive ? "text-emerald-700" : "text-stone-500"}`} title={`${money(before)} in the ${periodLabel}`}>
                  {d.pct === null ? "new" : `${d.pct > 0 ? "+" : ""}${d.pct}%`} vs {periodLabel}
                </p>
              ) : (
                <p className="mt-1 text-xs text-stone-400">no change vs {periodLabel}</p>
              )}
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {locations.length > 1 ? (
          <Card className="lg:col-span-2">
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">By location</h2>
            {byLocation.length === 0 ? <div className="p-4"><Empty title="No closed sales in this range" /></div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Location</th><th className="px-4 py-2 text-right">Sales</th><th className="px-4 py-2 text-right">Tips</th><th className="px-4 py-2 text-right">Tax</th><th className="px-4 py-2 text-right">Refunded</th><th className="px-4 py-2 text-right">Tickets</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {byLocation.map((r) => (
                    <tr key={r.locationId ?? "none"} className={r.locationId === locationFilter ? "bg-brand-50/40" : ""}>
                      <td className="px-4 py-2"><Link href={`?from=${from}&to=${to}&location=${r.locationId ?? ""}`} className="hover:underline">{r.locationName ?? "No location"}</Link></td>
                      <td className="px-4 py-2 text-right">{money(r.sales)}</td><td className="px-4 py-2 text-right">{money(r.tips)}</td><td className="px-4 py-2 text-right">{money(r.tax)}</td><td className="px-4 py-2 text-right">{money(r.refunded)}</td><td className="px-4 py-2 text-right">{Number(r.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            {crossLocation.length ? (
              <div className="border-t border-stone-200 px-4 py-3 text-sm">
                <p className="mb-1 font-medium text-stone-700">Redeemed here, sold elsewhere</p>
                <p className="mb-2 text-xs text-stone-500">Gift cards, package sessions and membership credits bought at one location and used at another. The selling location owes the redeeming one.</p>
                <ul className="space-y-1">
                  {crossLocation.map((r, i) => (
                    <li key={i} className="flex justify-between gap-3"><span>{r.kind === "gift_card" ? "Gift cards" : r.kind === "package" ? "Package sessions" : "Membership credits"} sold at <b>{locName(r.soldAt)}</b>, used at <b>{locName(r.redeemedAt)}</b> <span className="text-xs text-stone-500">× {r.count}</span></span><span className="font-medium">{money(r.amount)}</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        ) : null}
        <Card>
          <h2 className="flex items-center justify-between border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">
            By staff
            {can(permissions, "payroll.view") ? <Link href={`/app/${slug}/payroll?start=${from}&end=${to}${lq}`} className="text-xs font-normal text-brand-700 hover:underline">Payroll for this period</Link> : null}
          </h2>
          {byStaff.length === 0 ? <div className="p-4"><Empty title="No closed sales in this range" /></div> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Staff</th><th className="px-4 py-2 text-right">Services</th><th className="px-4 py-2 text-right">Products</th><th className="px-4 py-2 text-right">Tips</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {byStaff.map((r) => (
                  <tr key={r.staffId ?? "none"}><td className="px-4 py-2">{r.staffName ?? "Unassigned"}</td><td className="px-4 py-2 text-right">{money(r.services)}</td><td className="px-4 py-2 text-right">{money(r.products)}</td><td className="px-4 py-2 text-right">{money(r.tips)}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
        <Card>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">By payment method</h2>
          {byMethod.length === 0 ? <div className="p-4"><Empty title="No payments in this range" /></div> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Method</th><th className="px-4 py-2 text-right">Count</th><th className="px-4 py-2 text-right">Collected</th><th className="px-4 py-2 text-right">of which tips</th><th className="px-4 py-2 text-right">Refunded</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {byMethod.map((r) => (
                  <tr key={r.method}><td className="px-4 py-2 capitalize">{r.method.replace("_", " ")}</td><td className="px-4 py-2 text-right">{Number(r.count)}</td><td className="px-4 py-2 text-right">{money(r.amount)}</td><td className="px-4 py-2 text-right">{money(r.tips)}</td><td className="px-4 py-2 text-right">{money(r.refunded)}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
        <Card>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Top services &amp; products</h2>
          {byService.length === 0 ? <div className="p-4"><Empty title="Nothing sold in this range" /></div> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Item</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Revenue</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {byService.map((r) => <tr key={`${r.kind}:${r.name}`}><td className="px-4 py-2">{r.name} <span className="text-xs text-stone-400">{r.kind}</span></td><td className="px-4 py-2 text-right">{Number(r.count)}</td><td className="px-4 py-2 text-right">{money(r.amount)}</td></tr>)}
              </tbody>
            </table></div>
          )}
        </Card>
        <Card>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Appointments in range</h2>
          {(() => {
            const total = appts.reduce((s, a) => s + Number(a.count), 0);
            const by = (st: string) => appts.filter((a) => a.status === st).reduce((s, a) => s + Number(a.count), 0);
            const online = appts.filter((a) => a.source === "online").reduce((s, a) => s + Number(a.count), 0);
            const rows: [string, number][] = [["Booked / confirmed", by("booked") + by("confirmed")], ["Completed", by("completed")], ["No-shows", by("no_show")], ["Cancelled", by("cancelled")], ["Booked online", online]];
            return total === 0 ? <div className="p-4"><Empty title="No appointments in this range" /></div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <tbody className="divide-y divide-stone-100">
                  {rows.map(([l, n]) => <tr key={l}><td className="px-4 py-2">{l}</td><td className="px-4 py-2 text-right">{n}</td><td className="px-4 py-2 text-right text-stone-500">{total ? Math.round((n / total) * 100) : 0}%</td></tr>)}
                  <tr className="font-medium"><td className="px-4 py-2">Total</td><td className="px-4 py-2 text-right">{total}</td><td /></tr>
                </tbody>
              </table></div>
            );
          })()}
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Closed sales</h2>
          {sales.length === 0 ? <div className="p-4"><Empty title="Nothing closed in this range" /></div> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">#</th><th className="px-4 py-2">When</th>{locations.length > 1 ? <th className="px-4 py-2">Location</th> : null}<th className="px-4 py-2">Client</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2 text-right">Tips</th><th className="px-4 py-2">Status</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2"><Link href={`/app/${slug}/sales/${s.id}`} className="text-brand-700 underline">{s.number}</Link></td>
                    <td className="px-4 py-2">{s.closedAt ? fmt.format(s.closedAt) : ""}</td>
                    {locations.length > 1 ? <td className="px-4 py-2 text-stone-600">{s.locationName ?? ""}</td> : null}
                    <td className="px-4 py-2">{s.clientFirst ? `${s.clientFirst} ${s.clientLast ?? ""}` : "Walk-in"}</td>
                    <td className="px-4 py-2 text-right">{money(s.totalCents)}</td>
                    <td className="px-4 py-2 text-right">{money(s.tipCents)}</td>
                    <td className="px-4 py-2"><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      </div>
      {stock.items.length ? (
        <Card className="mt-6">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2"><h2 className="text-sm font-semibold text-stone-600">Stock on hand</h2><span className="text-xs text-stone-500">{stock.lowCount ? `${stock.lowCount} low · ` : ""}value at cost {money(stock.totalValueCents)} · retail {money(stock.totalRetailCents)}</span></div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-2">Product</th><th className="px-4 py-2 text-right">On hand</th><th className="px-4 py-2 text-right">Cost value</th><th className="px-4 py-2 text-right">Retail value</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {stock.items.map((i) => (
                <tr key={i.id} className={i.low ? "bg-amber-50/60" : ""}>
                  <td className="px-4 py-2"><Link href={`/app/${slug}/products/${i.id}`} className="hover:underline">{i.name}</Link>{i.category ? <span className="ml-1 text-xs text-stone-500">· {i.category}</span> : null}{i.low ? <span className="ml-2 text-xs font-medium text-amber-700">Low</span> : null}</td>
                  <td className="px-4 py-2 text-right">{i.stockQty}</td>
                  <td className="px-4 py-2 text-right">{money(i.valueCents)}</td>
                  <td className="px-4 py-2 text-right">{money(i.retailCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </>
  );
}
