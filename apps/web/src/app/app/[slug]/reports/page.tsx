import Link from "next/link";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { Download } from "lucide-react";

export const metadata: Metadata = { title: "Sales" };
import { can, instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { salesReport } from "@/server/sales";
import { stockReport } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { withTenant } from "@angelic/db";
import { payrollByLocation, runPayroll } from "@/server/payroll";
import { storeCreditSummary } from "@/server/store-credit";
import { refundsByReason } from "@/server/refund-reasons";
import { referralsInPeriod } from "@/server/loyalty";
import { formatDateLong, formatMoney, shiftISODate } from "@/lib/utils";
import { Button, Card, Input, PageHeader, Empty, LinkButton } from "@/components/ui";
import { LocationFilter } from "@/components/location-filter";
import { listLocations } from "@/server/locations";
import { listCategories, pathTo } from "@/server/categories";
import { CategoryTable, type CategoryLine } from "./category-table";
import { ServicePicker } from "@/components/service-picker";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { serviceGroups, serviceIdsInScope } from "@/server/service-groups";
import { parseScope, scopeLabel, scopeValue } from "@/lib/service-scope";

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; location?: string; service?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireAction(slug, "reports.view");
  const locations = await listLocations(business.id);
  const locationFilter = locations.some((l) => l.id === sp.location) ? sp.location! : null;
  const locName = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "Unknown") : "No location");
  // In a table of this business's own sites the business name is noise: "Glow Collective - Reston" reads "Reston".
  const siteLabel = (name: string | null) => (name ? (name.startsWith(`${business.name} - `) ? name.slice(business.name.length + 3) : name) : "No location");
  // Optional filter: sales that include one service, or any service in a category (and below).
  const groups = await serviceGroups(business, { meta: "none", categories: true });
  const scope = parseScope(sp.service, groups);
  const scopeVal = scopeValue(scope);
  const serviceIds = await serviceIdsInScope(business.id, scopeVal);
  const scoped = serviceIds !== null;
  const lq = `${locationFilter ? `&location=${locationFilter}` : ""}${scopeVal ? `&service=${encodeURIComponent(scopeVal)}` : ""}`;
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
  const [credit, creditBefore, byReason, referrals] = await withTenant(business.id, async (tx) => [
    await storeCreditSummary(tx, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz)),
    await storeCreditSummary(tx, zonedToInstant(prevFrom, "00:00", tz), zonedToInstant(from, "00:00", tz)),
    await refundsByReason(tx, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz)),
    business.loyaltyEnabled ? await referralsInPeriod(tx, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz)) : [],
  ]);
  // Pay is not split by service, so it is left out while a service filter is on.
  const canPayroll = can(permissions, "payroll.view") && !scoped;
  const [{ sales, byStaff, byMethod, byService, byCategory, appts, byLocation, crossLocation }, prev, categories, pay, payBefore, payByLoc] = await Promise.all([
    salesReport(business.id, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz), locationFilter, serviceIds),
    salesReport(business.id, zonedToInstant(prevFrom, "00:00", tz), zonedToInstant(from, "00:00", tz), locationFilter, serviceIds),
    listCategories(business.id, "service"),
    // What the period cost in pay: the same calculation as Payroll, overtime off, so the numbers agree.
    canPayroll ? runPayroll(business, { start: from, end: to }, false, locationFilter, { split: true }) : null,
    canPayroll ? runPayroll(business, { start: prevFrom, end: prevTo }, false, locationFilter, { split: true }) : null,
    // Pay by site (always every site, like the sales split) so the table adds up to the whole.
    canPayroll && locations.length > 1 ? payrollByLocation(business, { start: from, end: to }, locations.map((l) => l.id)) : null,
  ]);
  const payRows = (pay?.employees ?? []).filter((e) => e.hasActivity && (e.totalCents !== 0 || e.serviceRevenueCents !== 0));
  const payTotal = (rows: typeof payRows, k: "wageCents" | "mainCommissionCents" | "productCommissionCents" | "totalCents" | "serviceRevenueCents") => rows.reduce((s, e) => s + e[k], 0);
  const payBeforeRows = (payBefore?.employees ?? []).filter((e) => e.hasActivity);
  // One row per person: what was rung up (always) and what they cost (payroll permission only).
  type StaffRow = { staffId: string | null; name: string; services: number; products: number; tips: number; e: (typeof payRows)[number] | null };
  const staffRows: StaffRow[] = (() => {
    const map = new Map<string, StaffRow>();
    for (const r of byStaff) map.set(r.staffId ?? "none", { staffId: r.staffId, name: r.staffName ?? "Unassigned", services: Number(r.services), products: Number(r.products), tips: Number(r.tips), e: null });
    for (const e of payRows) {
      const row = map.get(e.employee.staffId) ?? { staffId: e.employee.staffId, name: e.employee.name, services: 0, products: 0, tips: 0, e: null };
      row.e = e;
      map.set(e.employee.staffId, row);
    }
    return [...map.values()].sort((a, b) => (a.staffId === null ? 1 : b.staffId === null ? -1 : (b.e?.totalCents ?? 0) - (a.e?.totalCents ?? 0) || b.services - a.services));
  })();
  // By location: every site that had sales or pay in the range.
  type LocRow = { locationId: string | null; locationName: string | null; sales: number; tips: number; tax: number; refunded: number; count: number };
  const locRows: LocRow[] = (() => {
    const rows: LocRow[] = byLocation.map((r) => ({ locationId: r.locationId, locationName: r.locationName, sales: Number(r.sales), tips: Number(r.tips), tax: Number(r.tax), refunded: Number(r.refunded), count: Number(r.count) }));
    if (payByLoc) {
      for (const [id, p] of payByLoc) {
        if (rows.some((r) => r.locationId === id) || (p.totalCents === 0 && p.wageCents === 0)) continue;
        rows.push({ locationId: id, locationName: id ? locName(id) : null, sales: 0, tips: 0, tax: 0, refunded: 0, count: 0 });
      }
    }
    return rows.sort((a, b) => (a.locationName === null ? 1 : b.locationName === null ? -1 : a.locationName.localeCompare(b.locationName)));
  })();
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
  const fmtDay = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz });

  return (
    <>
      <PageHeader title="Reports">
        <LocationFilter locations={locations} current={locationFilter} query={`from=${from}&to=${to}${scopeVal ? `&service=${encodeURIComponent(scopeVal)}` : ""}`} allLabel="All" />
        <AutoSubmitForm>
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          {locationFilter ? <input type="hidden" name="location" value={locationFilter} /> : null}
          <ServicePicker name="service" groups={groups} value={scopeVal} noneLabel="Any service" compact />
        </AutoSubmitForm>
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
              {scopeVal ? <input type="hidden" name="service" value={scopeVal} /> : null}
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
      {scoped ? (
        <p className="mb-4 rounded-lg bg-brand-50 px-3 py-2 text-sm text-stone-700">
          Showing sales that include <strong>{scopeLabel(scope, groups) ?? "this service"}</strong>; every line on those sales is counted. Pay, store credit, refund reasons, referrals and stock are not split by service, so they are hidden.{" "}
          <Link href={`?from=${from}&to=${to}${locationFilter ? `&location=${locationFilter}` : ""}`} className="underline">Clear</Link>
        </p>
      ) : null}

      <div className={`mb-6 grid gap-3 sm:grid-cols-2 ${scoped ? "lg:grid-cols-5" : "lg:grid-cols-6"}`}>
        {(
          [
            ["Sales", sum("totalCents") - sum("tipCents"), sum("totalCents", prev.sales) - sum("tipCents", prev.sales), true],
            ["Tips", sum("tipCents"), sum("tipCents", prev.sales), true],
            ["Discounts", sum("discountCents"), sum("discountCents", prev.sales), false],
            ["Tax collected", sum("taxCents"), sum("taxCents", prev.sales), true],
            ["Refunds", sum("refundedCents"), sum("refundedCents", prev.sales), false],
            ["Store credit issued", credit.issuedCents, creditBefore.issuedCents, false],
          ] as [string, number, number, boolean][]
        ).filter(([label]) => !(scoped && label === "Store credit issued")).map(([label, v, before, goodUp]) => {
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
            {locRows.length === 0 ? <div className="p-4"><Empty title="No closed sales in this range" /></div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500">
                  <tr>
                    <th className="py-2 pl-3 pr-2">Location</th><th className="px-2 py-2 text-right">Sales</th><th className="px-2 py-2 text-right">Tips</th><th className="px-2 py-2 text-right">Tax</th><th className="px-2 py-2 text-right">Refunded</th><th className="px-2 py-2 text-right">Tickets</th>
                    {payByLoc ? <><th className="px-2 py-2 text-right">Service commission</th><th className="px-2 py-2 text-right">Product commission</th><th className="px-2 py-2 text-right">Hourly / salary</th><th className="px-2 py-2 text-right">Total pay</th><th className="px-2 py-2 text-right">Cost of revenue</th></> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {locRows.map((r) => {
                    const lp = payByLoc?.get(r.locationId) ?? null;
                    return (
                      <tr key={r.locationId ?? "none"} className={r.locationId === locationFilter ? "bg-brand-50/40" : ""}>
                        <td className="whitespace-nowrap py-2 pl-3 pr-2"><Link href={`?from=${from}&to=${to}&location=${r.locationId ?? ""}`} className="hover:underline">{siteLabel(r.locationName)}</Link></td>
                        <td className="px-2 py-2 text-right">{money(r.sales)}</td><td className="px-2 py-2 text-right">{money(r.tips)}</td><td className="px-2 py-2 text-right">{money(r.tax)}</td><td className="px-2 py-2 text-right">{money(r.refunded)}</td><td className="px-2 py-2 text-right">{r.count}</td>
                        {lp ? (
                          <>
                            <td className="px-2 py-2 text-right tabular-nums">{money(lp.mainCommissionCents)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{money(lp.productCommissionCents)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{money(lp.wageCents)}</td>
                            <td className="px-2 py-2 text-right font-medium tabular-nums">{money(lp.totalCents)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-stone-600" title={lp.serviceRevenueCents ? `of ${money(lp.serviceRevenueCents)} service revenue` : undefined}>{laborPct(lp.mainCommissionCents + lp.productCommissionCents + lp.wageCents, lp.serviceRevenueCents)}</td>
                          </>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
                {payByLoc ? (
                  <tfoot className="border-t border-stone-200 font-semibold">
                    <tr>
                      <td className="py-2 pl-3 pr-2">Total</td>
                      <td className="px-2 py-2 text-right">{money(locRows.reduce((n, r) => n + r.sales, 0))}</td><td className="px-2 py-2 text-right">{money(locRows.reduce((n, r) => n + r.tips, 0))}</td><td className="px-2 py-2 text-right">{money(locRows.reduce((n, r) => n + r.tax, 0))}</td><td className="px-2 py-2 text-right">{money(locRows.reduce((n, r) => n + r.refunded, 0))}</td><td className="px-2 py-2 text-right">{locRows.reduce((n, r) => n + r.count, 0)}</td>
                      {(() => {
                        const all = [...payByLoc.values()];
                        const sum = (k: "mainCommissionCents" | "productCommissionCents" | "wageCents" | "totalCents" | "serviceRevenueCents") => all.reduce((n, p) => n + p[k], 0);
                        return (
                          <>
                            <td className="px-2 py-2 text-right tabular-nums">{money(sum("mainCommissionCents"))}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{money(sum("productCommissionCents"))}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{money(sum("wageCents"))}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{money(sum("totalCents"))}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{laborPct(sum("mainCommissionCents") + sum("productCommissionCents") + sum("wageCents"), sum("serviceRevenueCents"))}</td>
                          </>
                        );
                      })()}
                    </tr>
                  </tfoot>
                ) : null}
              </table></div>
            )}
            {payByLoc ? <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">Pay by site, calculated the way Payroll does with overtime off and before adjustments or withholding. Commissions follow the location of the sale, hourly pay follows where the person clocked in, and salary is charged to their primary location. Tips are passed through, not a cost.</p> : null}
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
        <Card className="lg:col-span-2">
          <h2 className="flex items-center justify-between border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">
            Staff
            {canPayroll ? <Link href={`/app/${slug}/payroll?start=${from}&end=${to}${lq}`} className="text-xs font-normal text-brand-700 hover:underline">Open in Payroll</Link> : null}
          </h2>
          {staffRows.length === 0 ? <div className="p-4"><Empty title="No closed sales in this range" body={canPayroll ? "Sales, tips and pay appear here once staff have activity." : undefined} /></div> : (
            <>
              {canPayroll && payRows.length ? (
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
                        <p className="text-xs text-stone-500">{d === null ? `no change vs ${periodLabel}` : d.pct === null ? `new vs ${periodLabel}` : `${d.pct > 0 ? "+" : ""}${d.pct}% vs ${periodLabel}`}</p>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500">
                  <tr>
                    <th className="py-2 pl-3 pr-2">Staff</th><th className="px-2 py-2 text-right">Services</th><th className="px-2 py-2 text-right">Products</th><th className="px-2 py-2 text-right">Tips</th>
                    {canPayroll ? <><th className="px-2 py-2 text-right">Service commission</th><th className="px-2 py-2 text-right">Product commission</th><th className="px-2 py-2 text-right">Hourly / salary</th><th className="px-2 py-2 text-right">Total pay</th><th className="px-2 py-2 text-right">Cost of revenue</th></> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {staffRows.map((r) => (
                    <tr key={r.staffId ?? "none"}>
                      <td className="whitespace-nowrap py-2 pl-3 pr-2"><span className="font-medium">{r.name}</span>{canPayroll && r.e ? <span className="block text-xs text-stone-500">{r.e.employee.payType === "commission" ? "Commission" : r.e.employee.payType === "hourly" ? "Hourly" : "Salary"}</span> : null}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(r.services)}</td><td className="px-2 py-2 text-right tabular-nums">{money(r.products)}</td><td className="px-2 py-2 text-right tabular-nums">{money(r.tips)}</td>
                      {canPayroll ? (
                        r.e ? (
                          <>
                            <td className="px-2 py-2 text-right tabular-nums">{money(r.e.mainCommissionCents)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{money(r.e.productCommissionCents)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{money(r.e.wageCents)}</td>
                            <td className="px-2 py-2 text-right font-medium tabular-nums">{money(r.e.totalCents)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-stone-600" title={r.e.serviceRevenueCents ? `of ${money(r.e.serviceRevenueCents)} service revenue` : undefined}>{laborPct(r.e.mainCommissionCents + r.e.productCommissionCents + r.e.wageCents, r.e.serviceRevenueCents)}</td>
                          </>
                        ) : <td className="px-2 py-2 text-stone-400" colSpan={5} />
                      ) : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-stone-200 font-semibold">
                  <tr>
                    <td className="py-2 pl-3 pr-2">Total</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(staffRows.reduce((n, r) => n + r.services, 0))}</td><td className="px-2 py-2 text-right tabular-nums">{money(staffRows.reduce((n, r) => n + r.products, 0))}</td><td className="px-2 py-2 text-right tabular-nums">{money(staffRows.reduce((n, r) => n + r.tips, 0))}</td>
                    {canPayroll ? (
                      <>
                        <td className="px-2 py-2 text-right tabular-nums">{money(payTotal(payRows, "mainCommissionCents"))}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{money(payTotal(payRows, "productCommissionCents"))}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{money(payTotal(payRows, "wageCents"))}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{money(payTotal(payRows, "totalCents"))}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{laborPct(payTotal(payRows, "mainCommissionCents") + payTotal(payRows, "productCommissionCents") + payTotal(payRows, "wageCents"), payTotal(payRows, "serviceRevenueCents"))}</td>
                      </>
                    ) : null}
                  </tr>
                </tfoot>
              </table></div>
              {canPayroll ? (
                <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">
                  Services, products and tips are what was rung up. Pay is calculated the way Payroll does for these dates, with overtime off and before adjustments or withholding: commissions on amounts paid after discounts, with package and membership credits counted for the provider. Tips are passed through, not a cost. Cost of revenue is commissions plus wages as a share of the service revenue Payroll credits to that person.
                  {locationFilter ? ` Filtered to ${locName(locationFilter)}: commissions follow this site's sales, hourly pay its time-clock entries, and salary only people whose primary location it is.` : ""}
                </p>
              ) : null}
            </>
          )}
        </Card>
        <Card className={scoped ? "hidden" : ""}>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Refunds by reason</h2>
          {byReason.length === 0 ? <div className="p-4"><Empty title="No refunds in this range" /></div> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Reason</th><th className="px-4 py-2 text-right">Refunds</th><th className="px-4 py-2 text-right">Money back</th><th className="px-4 py-2 text-right">Store credit</th><th className="px-4 py-2 text-right">Total</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {byReason.map((r) => (
                  <tr key={r.reasonId ?? "none"}><td className="px-4 py-2">{r.name}</td><td className="px-4 py-2 text-right tabular-nums">{r.count}</td><td className="px-4 py-2 text-right tabular-nums">{money(r.moneyCents)}</td><td className="px-4 py-2 text-right tabular-nums">{money(r.creditCents)}</td><td className="px-4 py-2 text-right font-medium tabular-nums">{money(r.moneyCents + r.creditCents)}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
          {can(permissions, "business.manage") ? <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">Reasons are managed under <Link href={`/app/${slug}/settings/refund-reasons`} className="text-brand-700 underline">Settings → Refund reasons</Link>.</p> : null}
        </Card>
        {business.loyaltyEnabled && !scoped ? (
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Referrals</h2>
            {referrals.length === 0 ? <div className="p-4"><Empty title="No referrals joined or had a first visit in this range" /></div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Referred by</th><th className="px-4 py-2">New client</th><th className="px-4 py-2">Joined</th><th className="px-4 py-2">First paid visit</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {referrals.map((r) => (
                    <tr key={r.referredId}>
                      <td className="px-4 py-2"><Link href={`/app/${slug}/clients/${r.referrerId}`} className="hover:underline">{r.referrerName}</Link></td>
                      <td className="px-4 py-2"><Link href={`/app/${slug}/clients/${r.referredId}`} className="hover:underline">{r.referredName}</Link></td>
                      <td className="whitespace-nowrap px-4 py-2 text-stone-600">{fmtDay.format(r.joinedAt)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-stone-600">{r.rewardedAt ? `${fmtDay.format(r.rewardedAt)} · ${business.referralBonusPoints} pts paid` : <span className="text-stone-400">not yet</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">{referrals.length} referred · {referrals.filter((r) => r.rewardedAt).length} visited and paid. Codes are on receipts, the client account page and the “Refer a friend” automation.</p>
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
      {stock.items.length && !scoped ? (
        <Card className="mt-6">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2"><h2 className="text-sm font-semibold text-stone-600">Stock on hand</h2><span className="text-xs text-stone-500">{stock.lowCount ? `${stock.lowCount} low · ` : ""}value at cost {money(stock.totalValueCents)} · retail {money(stock.totalRetailCents)}</span></div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-2">Product</th><th className="px-4 py-2 text-right">On hand</th><th className="px-4 py-2 text-right">Cost value</th><th className="px-4 py-2 text-right">Retail value</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {stock.items.map((i) => (
                <tr key={i.id} className={i.low ? "bg-amber-50/60" : ""}>
                  <td className="px-4 py-2"><Link href={`/app/${slug}/products/${i.id}`} className="hover:underline">{productLabel(i)}</Link>{i.category ? <span className="ml-1 text-xs text-stone-500">· {i.category}</span> : null}{i.status === "negative" ? <span className="ml-2 text-xs font-medium text-red-700">Count is off</span> : i.status === "out" ? <span className="ml-2 text-xs font-medium text-red-700">Out</span> : i.low ? <span className="ml-2 text-xs font-medium text-amber-700">Low</span> : null}</td>
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
