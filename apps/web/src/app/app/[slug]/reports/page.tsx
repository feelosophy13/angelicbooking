import Link from "next/link";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { Download } from "lucide-react";

export const metadata: Metadata = { title: "Sales" };
import { can, instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { salesReport } from "@/server/sales";
import { stockReport } from "@/server/inventory";
import { withTenant } from "@angelic/db";
import { runPayroll } from "@/server/payroll";
import { storeCreditSummary } from "@/server/store-credit";
import { formatDateLong, formatMoney, shiftISODate } from "@/lib/utils";
import { Button, Card, Input, PageHeader, Empty, LinkButton } from "@/components/ui";
import { LocationFilter } from "@/components/location-filter";
import { listLocations } from "@/server/locations";
import { listCategories, pathTo } from "@/server/categories";
import { CategoryTable, type CategoryLine } from "./category-table";

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
  // Month to date by default: "today" is often empty (closed day, early morning) and looks like missing data.
  const from = isDate(sp.from) ? sp.from! : `${today.slice(0, 8)}01`;
  const to = isDate(sp.to) ? sp.to! : isDate(sp.from) ? from : today;
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
  const prevFrom = shiftISODate(from, -days);
  const prevTo = shiftISODate(from, -1);
  const isPreset = (from === today && to === today) || (from === shiftISODate(today, -6) && to === today) || (from === `${today.slice(0, 8)}01` && to === today);
  const stock = await stockReport(business.id);
  const [credit, creditBefore] = await withTenant(business.id, async (tx) => [
    await storeCreditSummary(tx, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz)),
    await storeCreditSummary(tx, zonedToInstant(prevFrom, "00:00", tz), zonedToInstant(from, "00:00", tz)),
  ]);
  const canPayroll = can(permissions, "payroll.view");
  const [{ sales, byStaff, byMethod, byService, byCategory, appts, byLocation, crossLocation }, prev, categories, pay, payBefore] = await Promise.all([
    salesReport(business.id, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz), locationFilter),
    salesReport(business.id, zonedToInstant(prevFrom, "00:00", tz), zonedToInstant(from, "00:00", tz), locationFilter),
    listCategories(business.id, "service"),
    // What the period cost in pay: the same calculation as Payroll, overtime off, so the numbers agree.
    canPayroll ? runPayroll(business, { start: from, end: to }, false, locationFilter) : null,
    canPayroll ? runPayroll(business, { start: prevFrom, end: prevTo }, false, locationFilter) : null,
  ]);
  const payRows = (pay?.employees ?? []).filter((e) => e.hasActivity && (e.totalCents !== 0 || e.serviceRevenueCents !== 0));
  const payTotal = (rows: typeof payRows, k: "wageCents" | "mainCommissionCents" | "productCommissionCents" | "totalCents" | "serviceRevenueCents") => rows.reduce((s, e) => s + e[k], 0);
  const payBeforeRows = (payBefore?.employees ?? []).filter((e) => e.hasActivity);
  const tipsOf = (e: (typeof payRows)[number]) => e.cashTipsCents + e.cardTipsCents;
  const laborPct = (cost: number, rev: number) => (rev > 0 ? `${Math.round((cost / rev) * 100)}%` : "—");
  // Service revenue by category: leaves roll up into their top-level category, with the second level shown under it.
  type CatRow = { id: string; name: string; amount: number; count: number; before: number; children: CatRow[] };
  const rollUp = (rows: { categoryId: string | null; amount: number; count: number }[]) => {
    const tops = new Map<string, CatRow>();
    const other: CatRow = { id: "none", name: "Uncategorised", amount: 0, count: 0, before: 0, children: [] };
    for (const r of rows) {
      const path = r.categoryId ? pathTo(categories, r.categoryId) : [];
      const top = path[0];
      if (!top) { other.amount += Number(r.amount); other.count += Number(r.count); continue; }
      if (!tops.has(top.id)) tops.set(top.id, { id: top.id, name: top.name, amount: 0, count: 0, before: 0, children: [] });
      const t = tops.get(top.id)!;
      t.amount += Number(r.amount); t.count += Number(r.count);
      const second = path[1];
      if (second) {
        let c = t.children.find((x) => x.id === second.id);
        if (!c) { c = { id: second.id, name: second.name, amount: 0, count: 0, before: 0, children: [] }; t.children.push(c); }
        c.amount += Number(r.amount); c.count += Number(r.count);
      }
    }
    const out = [...tops.values()];
    if (other.count) out.push(other);
    return out;
  };
  const catRows = rollUp(byCategory);
  const catBefore = rollUp(prev.byCategory);
  for (const t of catRows) {
    const b = catBefore.find((x) => x.id === t.id);
    t.before = b?.amount ?? 0;
    for (const c of t.children) c.before = b?.children.find((x) => x.id === c.id)?.amount ?? 0;
    t.children.sort((x, y) => y.amount - x.amount);
  }
  catRows.sort((x, y) => y.amount - x.amount);
  const serviceRevenue = catRows.reduce((s, r) => s + r.amount, 0);
  const toLine = (r: CatRow): CategoryLine => {
    const d = delta(r.amount, r.before);
    return { id: r.id, name: r.name, count: r.count, revenue: money(r.amount), share: serviceRevenue ? (r.amount / serviceRevenue) * 100 : 0, change: d === null ? "—" : d.pct === null ? "new" : `${d.pct > 0 ? "+" : ""}${d.pct}%`, tone: d === null ? "flat" : d.up ? "up" : "down", children: r.children.map(toLine) };
  };
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

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {(
          [
            ["Sales", sum("totalCents") - sum("tipCents"), sum("totalCents", prev.sales) - sum("tipCents", prev.sales), true],
            ["Tips", sum("tipCents"), sum("tipCents", prev.sales), true],
            ["Discounts", sum("discountCents"), sum("discountCents", prev.sales), false],
            ["Tax collected", sum("taxCents"), sum("taxCents", prev.sales), true],
            ["Refunds", sum("refundedCents"), sum("refundedCents", prev.sales), false],
            ["Store credit issued", credit.issuedCents, creditBefore.issuedCents, false],
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
        {canPayroll ? (
          <Card className="lg:col-span-2">
            <h2 className="flex items-center justify-between border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">
              Pay &amp; commissions
              <Link href={`/app/${slug}/payroll?start=${from}&end=${to}${lq}`} className="text-xs font-normal text-brand-700 hover:underline">Open in Payroll</Link>
            </h2>
            {payRows.length === 0 ? <div className="p-4"><Empty title="No pay in this range" body="Service and product commissions, hourly and salary pay appear here once staff have activity." /></div> : (
              <>
                <div className="grid grid-cols-2 gap-px border-b border-stone-200 bg-stone-100 md:grid-cols-4">
                  {([
                    ["Service commissions", payTotal(payRows, "mainCommissionCents"), payTotal(payBeforeRows, "mainCommissionCents")],
                    ["Product commissions", payTotal(payRows, "productCommissionCents"), payTotal(payBeforeRows, "productCommissionCents")],
                    ["Hourly & salary", payTotal(payRows, "wageCents"), payTotal(payBeforeRows, "wageCents")],
                    ["Total pay", payTotal(payRows, "totalCents"), payTotal(payBeforeRows, "totalCents")],
                  ] as const).map(([label, cur, before]) => {
                    const d = delta(cur, before);
                    return (
                      <div key={label} className="bg-white px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
                        <p className="text-lg font-semibold tabular-nums">{money(cur)}</p>
                        <p className={`text-xs ${d === null ? "text-stone-400" : d.up ? "text-stone-500" : "text-stone-500"}`}>{d === null ? `no change vs ${periodLabel}` : d.pct === null ? `new vs ${periodLabel}` : `${d.pct > 0 ? "+" : ""}${d.pct}% vs ${periodLabel}`}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Staff</th><th className="px-4 py-2">Pay type</th><th className="px-4 py-2 text-right">Service revenue</th><th className="px-4 py-2 text-right">Service commission</th><th className="px-4 py-2 text-right">Product commission</th><th className="px-4 py-2 text-right">Hourly / salary</th><th className="px-4 py-2 text-right">Tips</th><th className="px-4 py-2 text-right">Total pay</th><th className="px-4 py-2 text-right">Cost of revenue</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {[...payRows].sort((a, b) => b.totalCents - a.totalCents).map((e) => (
                      <tr key={e.employee.staffId}>
                        <td className="px-4 py-2 font-medium">{e.employee.name}</td>
                        <td className="px-4 py-2 text-stone-600">{e.employee.payType === "commission" ? "Commission" : e.employee.payType === "hourly" ? "Hourly" : "Salary"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(e.serviceRevenueCents)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(e.mainCommissionCents)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(e.productCommissionCents)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(e.wageCents)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-600">{money(tipsOf(e))}</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums">{money(e.totalCents)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-600">{laborPct(e.mainCommissionCents + e.productCommissionCents + e.wageCents, e.serviceRevenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-stone-200 font-semibold">
                    <tr>
                      <td className="px-4 py-2" colSpan={2}>Total</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(payTotal(payRows, "serviceRevenueCents"))}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(payTotal(payRows, "mainCommissionCents"))}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(payTotal(payRows, "productCommissionCents"))}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(payTotal(payRows, "wageCents"))}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(payRows.reduce((s, e) => s + tipsOf(e), 0))}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(payTotal(payRows, "totalCents"))}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{laborPct(payTotal(payRows, "mainCommissionCents") + payTotal(payRows, "productCommissionCents") + payTotal(payRows, "wageCents"), payTotal(payRows, "serviceRevenueCents"))}</td>
                    </tr>
                  </tfoot>
                </table></div>
                <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">Calculated the way Payroll does for these dates, with overtime off and before adjustments or withholding. Tips are passed through, not a cost. Cost of revenue is commissions plus wages as a share of the service revenue that person generated.</p>
              </>
            )}
          </Card>
        ) : null}
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
        <Card className="lg:col-span-2">
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Revenue by service category</h2>
          {catRows.length === 0 ? <div className="p-4"><Empty title="No services sold in this range" /></div> : (
            <CategoryTable rows={catRows.map(toLine)} total={{ count: catRows.reduce((s, r) => s + r.count, 0), revenue: money(serviceRevenue) }} periodLabel={periodLabel} />
          )}
          <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">Service lines on paid tickets, by the service's category today. Sub-categories are listed when a category has more than one.</p>
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
