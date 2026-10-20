import Link from "next/link";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { ChevronRight, Download } from "lucide-react";

export const metadata: Metadata = { title: "Sales" };
import { can, instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { clientCohorts, lapsedClients, salesReport } from "@/server/sales";
import { canSeeClientContact, canSeeClientSpend } from "@/lib/visibility";
import { LinkRow } from "@/components/table-row";
import { stockReport } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { withTenant } from "@angelic/db";
import { payByCategory, payrollByLocation, runPayroll } from "@/server/payroll";
import { storeCreditSummary } from "@/server/store-credit";
import { refundsByItem, refundsByReason } from "@/server/refund-reasons";
import { cancellationsByReason } from "@/server/cancellation-reasons";
import { referralsInPeriod } from "@/server/loyalty";
import { formatDateLong, formatMoney, shiftISODate } from "@/lib/utils";
import { Button, Card, Input, PageHeader, Empty, LinkButton } from "@/components/ui";
import { LocationFilter } from "@/components/location-filter";
import { listLocations } from "@/server/locations";
import { listCategories } from "@/server/categories";
import { rollUpCategories, withPrevious, type CategoryRow } from "@/lib/category-rollup";
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
  const [credit, creditBefore, byReason, cancels, referrals, byItem] = await withTenant(business.id, async (tx) => [
    await storeCreditSummary(tx, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz)),
    await storeCreditSummary(tx, zonedToInstant(prevFrom, "00:00", tz), zonedToInstant(from, "00:00", tz)),
    await refundsByReason(tx, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz)),
    await cancellationsByReason(tx, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz)),
    business.loyaltyEnabled ? await referralsInPeriod(tx, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz)) : [],
    await refundsByItem(tx, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz)),
  ] as const);
  // Pay is not split by service, so it is left out while a service filter is on.
  const canPayroll = can(permissions, "payroll.manage") && !scoped;
  const [{ sales, byStaff, byMethod, byService, byCategory, prepaidSold, prepaidUsedCents, appts, byLocation, linesByLocation, crossLocation, tipCashCents, tipCardCents, refundsCents, refundsByLocation, refundsByStaff, refundStaffNames }, prev, cohorts, cohortsBefore, lapsed, categories, pay, payBefore, payByLoc, catPay, catPayBefore] = await Promise.all([
    salesReport(business.id, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz), locationFilter, serviceIds),
    salesReport(business.id, zonedToInstant(prevFrom, "00:00", tz), zonedToInstant(from, "00:00", tz), locationFilter, serviceIds),
    // Who came: new, returning and lapsed clients. Visits are not split by service, so the card is left out while a service filter is on.
    scoped ? null : clientCohorts(business.id, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz), { lapsedDays: business.lapsedAfterDays, locationId: locationFilter }),
    scoped ? null : clientCohorts(business.id, zonedToInstant(prevFrom, "00:00", tz), zonedToInstant(from, "00:00", tz), { lapsedDays: business.lapsedAfterDays, locationId: locationFilter }),
    // Lapsed as of today, whatever the period: the people to call now.
    scoped ? null : lapsedClients(business.id, { lapsedDays: business.lapsedAfterDays, locationId: locationFilter }),
    listCategories(business.id, "service"),
    // What the period cost in pay: the same calculation as Payroll, overtime off, so the numbers agree.
    canPayroll ? runPayroll(business, { start: from, end: to }, false, locationFilter, { split: true }) : null,
    canPayroll ? runPayroll(business, { start: prevFrom, end: prevTo }, false, locationFilter, { split: true }) : null,
    // Pay by site (always every site, like the sales split) so the table adds up to the whole.
    canPayroll && locations.length > 1 ? payrollByLocation(business, { start: from, end: to }, locations.map((l) => l.id)) : null,
    // Commission by the performed service's category, the same way, so Profit on the category table is revenue less what Payroll pays on it.
    canPayroll ? payByCategory(business, { start: from, end: to }, locationFilter) : null,
    canPayroll ? payByCategory(business, { start: prevFrom, end: prevTo }, locationFilter) : null,
  ]);
  const payRows = (pay?.employees ?? []).filter((e) => e.hasActivity && (e.totalCents !== 0 || e.serviceRevenueCents !== 0));
  const payTotal = (rows: typeof payRows, k: "wageCents" | "mainCommissionCents" | "productCommissionCents" | "totalCents" | "serviceRevenueCents") => rows.reduce((s, e) => s + e[k], 0);
  const payBeforeRows = (payBefore?.employees ?? []).filter((e) => e.hasActivity);
  // One row per person: what was rung up (always) and what they cost (payroll permission only).
  type StaffRow = { staffId: string | null; name: string; services: number; products: number; tips: number; refunded: number; e: (typeof payRows)[number] | null };
  const staffRows: StaffRow[] = (() => {
    const map = new Map<string, StaffRow>();
    for (const r of byStaff) map.set(r.staffId ?? "none", { staffId: r.staffId, name: r.staffName ?? "Unassigned", services: Number(r.services), products: Number(r.products), tips: Number(r.tips), refunded: refundsByStaff.get(r.staffId) ?? 0, e: null });
    for (const e of payRows) {
      const row = map.get(e.employee.staffId) ?? { staffId: e.employee.staffId, name: e.employee.name, services: 0, products: 0, tips: 0, refunded: refundsByStaff.get(e.employee.staffId) ?? 0, e: null };
      row.e = e;
      map.set(e.employee.staffId, row);
    }
    // Someone refunded in the range with nothing rung up in it still gets a row, so the refunds column foots.
    for (const [staffId, cents] of refundsByStaff) {
      const key = staffId ?? "none";
      if (cents && !map.has(key)) map.set(key, { staffId, name: staffId ? (refundStaffNames.get(staffId) ?? "Former staff") : "Unassigned", services: 0, products: 0, tips: 0, refunded: cents, e: null });
    }
    return [...map.values()].sort((a, b) => (a.staffId === null ? 1 : b.staffId === null ? -1 : (b.e?.totalCents ?? 0) - (a.e?.totalCents ?? 0) || b.services - a.services));
  })();
  // By location: every site that had sales or pay in the range.
  type LocRow = { locationId: string | null; locationName: string | null; sales: number; services: number; products: number; tips: number; tax: number; refunded: number; count: number };
  const locRows: LocRow[] = (() => {
    const rows: LocRow[] = byLocation.map((r) => ({ locationId: r.locationId, locationName: r.locationName, sales: Number(r.sales), services: linesByLocation.get(r.locationId)?.services ?? 0, products: linesByLocation.get(r.locationId)?.products ?? 0, tips: Number(r.tips), tax: Number(r.tax), refunded: refundsByLocation.get(r.locationId) ?? 0, count: Number(r.count) }));
    if (payByLoc) {
      for (const [id, p] of payByLoc) {
        if (rows.some((r) => r.locationId === id) || (p.totalCents === 0 && p.wageCents === 0)) continue;
        rows.push({ locationId: id, locationName: id ? locName(id) : null, sales: 0, services: 0, products: 0, tips: 0, tax: 0, refunded: refundsByLocation.get(id) ?? 0, count: 0 });
      }
    }
    return rows.sort((a, b) => (a.locationName === null ? 1 : b.locationName === null ? -1 : a.locationName.localeCompare(b.locationName)));
  })();
  const laborPct = (cost: number, rev: number) => (rev > 0 ? `${Math.round((cost / rev) * 100)}%` : "—");
  // Service revenue by category: leaves roll up into their top-level category, with the second level shown under it. Paid at the visit and
  // sessions used (package or membership credit, at the session's value) are kept apart; the sort and share are on their sum.
  const catRows = withPrevious(rollUpCategories(byCategory, categories, catPay), rollUpCategories(prev.byCategory, categories, catPayBefore));
  const catTotal = (k: "count" | "paid" | "credit") => catRows.reduce((s, r) => s + r[k], 0);
  const catPayTotal = catPay ? catRows.reduce((s, r) => s + (r.pay ?? 0), 0) : null;
  const serviceRevenue = catTotal("paid") + catTotal("credit");
  const toLine = (r: CategoryRow): CategoryLine => {
    const total = r.paid + r.credit;
    const d = delta(total, r.before);
    return {
      id: r.id,
      name: r.name,
      count: r.count,
      services: money(r.paid),
      prepaid: money(r.credit),
      total: money(total),
      share: serviceRevenue ? (total / serviceRevenue) * 100 : 0,
      change: d === null ? "—" : d.pct === null ? "new" : `${d.pct > 0 ? "+" : ""}${d.pct}%`,
      tone: d === null ? "flat" : d.up ? "up" : "down",
      ...(r.pay !== null ? { pay: money(r.pay), profit: money(total - r.pay) } : {}),
      children: r.children.map(toLine),
    };
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
  // Retention: of the clients due back in the period, the share who came back in time or booked ahead, in whole percent (null = nobody was due).
  const retention = (c: NonNullable<typeof cohorts>) => (c.dueBack > 0 ? Math.round((c.retained / c.dueBack) * 100) : null);
  const canContact = canSeeClientContact(permissions);
  const canSpend = canSeeClientSpend(permissions);
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
        <div data-segmented className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="Period">
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
        {sales.length || appts.length ? (
          <details className="relative">
            <summary className="flex cursor-pointer select-none items-center gap-1 rounded-lg px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 marker:content-none [&::-webkit-details-marker]:hidden"><Download className="h-4 w-4" /> Export</summary>
            <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-lg">
              {sales.length ? <a href={`/app/${slug}/reports/export?kind=sales&from=${from}&to=${to}${lq}`} className="block px-3 py-1.5 hover:bg-stone-50">Sales (CSV)</a> : null}
              {catRows.length ? <a href={`/app/${slug}/reports/export?kind=categories&from=${from}&to=${to}${lq}`} className="block px-3 py-1.5 hover:bg-stone-50">Revenue by category (CSV)</a> : null}
              {cohorts ? <a href={`/app/${slug}/reports/export?kind=clients&from=${from}&to=${to}${lq}`} className="block px-3 py-1.5 hover:bg-stone-50">Clients (CSV)</a> : null}
              {appts.length ? <a href={`/app/${slug}/reports/export?kind=appointments&from=${from}&to=${to}${lq}`} className="block px-3 py-1.5 hover:bg-stone-50">Appointments (CSV)</a> : null}
            </div>
          </details>
        ) : null}
      </PageHeader>
      <p className="mb-4 text-sm text-stone-600">{from === to ? formatDateLong(from) : `${formatDateLong(from)} – ${formatDateLong(to)}`}{locationFilter ? ` · ${locName(locationFilter)}` : ""}<span className="ml-2 text-xs text-stone-500">Sales count on the day they were paid; refunds on the day they were made; staff revenue is after discounts.</span></p>
      {scoped ? (
        <p className="mb-4 rounded-lg bg-brand-50 px-3 py-2 text-sm text-stone-700">
          Showing sales that include <strong>{scopeLabel(scope, groups) ?? "this service"}</strong>; every line on those sales is counted. Pay, store credit, refund reasons, referrals, client cohorts and stock are not split by service, so they are hidden.{" "}
          <Link href={`?from=${from}&to=${to}${locationFilter ? `&location=${locationFilter}` : ""}`} className="underline">Clear</Link>
        </p>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Sales", sum("totalCents") - sum("tipCents"), sum("totalCents", prev.sales) - sum("tipCents", prev.sales), true],
            ["Tips", sum("tipCents"), sum("tipCents", prev.sales), true],
            ["Discounts", sum("discountCents"), sum("discountCents", prev.sales), false],
            ["Tax collected", sum("taxCents"), sum("taxCents", prev.sales), true],
            ["Refunds", refundsCents, prev.refundsCents, false],
            ["Store credit issued", credit.issuedCents, creditBefore.issuedCents, false],
            // Prepaid: money taken for packages and membership periods (part of Sales), and the value of the sessions used in the range.
            ["Prepaid sold", prepaidSold.packagesCents + prepaidSold.membershipCents, prev.prepaidSold.packagesCents + prev.prepaidSold.membershipCents, true],
            ["Prepaid used", prepaidUsedCents, prev.prepaidUsedCents, true],
          ] as [string, number, number, boolean][]
        ).filter(([label]) => !(scoped && label === "Store credit issued")).map(([label, v, before, goodUp]) => {
          const d = delta(v, before);
          const positive = d ? d.up === goodUp : null;
          return (
            <Card key={label} className="p-4">
              <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
              <p className="text-xl font-semibold">{money(v)}</p>
              {label === "Tips" && v > 0 ? <p className="text-xs text-stone-500">cash {money(tipCashCents)} · card {money(tipCardCents)}</p> : null}
              {label === "Prepaid sold" && v > 0 ? <p className="text-xs text-stone-500">packages {money(prepaidSold.packagesCents)} · membership fees {money(prepaidSold.membershipCents)}</p> : null}
              {label === "Prepaid used" && v > 0 ? <p className="text-xs text-stone-500">sessions used, at their value</p> : null}
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

      {cohorts && cohortsBefore && lapsed ? (
        <Card className="mb-6">
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Clients</h2>
          <div className="grid grid-cols-2 gap-px bg-stone-100 md:grid-cols-4">
            {(() => {
              const ret = retention(cohorts);
              const retBefore = retention(cohortsBefore);
              const N = cohorts.lapsedDays;
              const change = (d: ReturnType<typeof delta>) => (d === null ? `no change vs ${periodLabel}` : d.pct === null ? `new vs ${periodLabel}` : `${d.pct > 0 ? "+" : ""}${d.pct}% vs ${periodLabel}`);
              const tiles: { label: string; value: string; sub: string | null; change: string; good: boolean | null }[] = [
                ...([
                  ["New", cohorts.fresh, cohortsBefore.fresh],
                  ["Returning", cohorts.returning, cohortsBefore.returning],
                ] as const).map(([label, cur, before]) => {
                  const d = delta(cur.count, before.count);
                  return { label, value: String(cur.count), sub: cur.count ? `${money(cur.revenueCents)} brought in` : null, change: change(d), good: d === null ? null : d.up };
                }),
                (() => {
                  const d = delta(cohorts.lost, cohortsBefore.lost);
                  return { label: `Didn't come back within ${N} days`, value: String(cohorts.lost), sub: cohorts.dueBack ? `of the ${cohorts.dueBack} clients whose ${N} days ran out this period` : `no client's ${N} days ran out this period`, change: change(d), good: d === null ? null : !d.up };
                })(),
                {
                  label: `Came back within ${N} days`,
                  value: ret === null ? "—" : `${ret}%`,
                  sub: cohorts.dueBack ? `${cohorts.retained} of the ${cohorts.dueBack} whose ${N} days ran out this period came back or booked` : `no client's ${N} days ran out this period`,
                  change: ret === null || retBefore === null ? (retBefore === null ? `nothing to compare in the ${periodLabel}` : `${retBefore}% in the ${periodLabel}`) : ret === retBefore ? `no change vs ${periodLabel}` : `${ret > retBefore ? "+" : ""}${ret - retBefore} pts vs ${periodLabel}`,
                  good: ret === null || retBefore === null || ret === retBefore ? null : ret > retBefore,
                },
              ];
              return tiles.map((t) => (
                <div key={t.label} className="bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-stone-500">{t.label}</p>
                  <p className="text-xl font-semibold tabular-nums">{t.value}</p>
                  {t.sub ? <p className="text-xs text-stone-500">{t.sub}</p> : null}
                  <p className={`mt-1 text-xs ${t.good ? "text-emerald-700" : t.good === null ? "text-stone-400" : "text-stone-500"}`}>{t.change}</p>
                </div>
              ));
            })()}
          </div>
          <div className="border-t border-stone-200">
            <p className="flex flex-wrap items-baseline gap-x-2 px-4 pt-3 text-sm">
              <span className="font-medium text-stone-700">No visit in the last {cohorts.lapsedDays} days, as of today: {lapsed.count} {lapsed.count === 1 ? "client" : "clients"}</span>
              <span className="text-xs text-stone-500">{lapsed.count ? `${money(lapsed.revenueCents)} spent in the year before they lapsed${lapsed.count > lapsed.top.length ? ` · the ${lapsed.top.length} biggest spenders below` : ""}` : `nobody has gone ${cohorts.lapsedDays} days without a visit and nothing booked`}</span>
            </p>
            {lapsed.top.length ? (
              <div className="overflow-x-auto"><table className="mt-1 w-full text-sm">
                <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Client</th><th className="px-4 py-2">Last visit</th><th className="px-4 py-2 text-right">Visits</th>{canSpend ? <th className="px-4 py-2 text-right">Spent, year before lapsing</th> : null}<th /></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {lapsed.top.map((c) => (
                    <LinkRow key={c.clientId} href={`/app/${slug}/clients/${c.clientId}`}>
                      <td className="px-4 py-2">
                        <Link href={`/app/${slug}/clients/${c.clientId}`} className="font-medium hover:underline">{`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Client"}</Link>
                        {canContact ? <p className="truncate text-xs text-stone-500">{[c.phone, c.email].filter(Boolean).join(" · ") || "no contact info"}</p> : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-stone-600">{fmtDay.format(c.lastVisit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{c.visits}</td>
                      {canSpend ? <td className="px-4 py-2 text-right tabular-nums">{money(c.spendCents)}</td> : null}
                      <td className="px-2 py-2 text-right"><Link href={`/app/${slug}/clients/${c.clientId}`} aria-label="Open"><ChevronRight className="h-4 w-4 text-stone-300" /></Link></td>
                    </LinkRow>
                  ))}
                </tbody>
              </table></div>
            ) : <div className="pb-3" />}
          </div>
          <div className="space-y-1 border-t border-stone-100 px-4 py-2 text-xs text-stone-500">
            <p>
              A visit is a completed appointment; revenue is closed sales less tips.
              {" "}New: clients whose first visit ever was in this period.
              {" "}Returning: clients who visited in this period and had visited before.
              {" "}The two {cohorts.lapsedDays}-day tiles look at the clients whose {cohorts.lapsedDays} days since their last visit ran out during this period (your &quot;lapsed after&quot; setting): &quot;Came back&quot; is the share of them who visited again within those {cohorts.lapsedDays} days or had a visit booked; &quot;Didn&apos;t come back&quot; is the rest.
              {" "}The line below is as of today, whatever the period: clients whose last visit was {cohorts.lapsedDays} or more days ago with nothing booked, the people to call.
              {locationFilter ? ` Visits and sales at ${locName(locationFilter)} anchor these; coming back or booking counts at any location.` : ""}
            </p>
            <p>
              Set the lapsed-after days to your clients&apos; usual gap between visits, or retention reads low.
              {can(permissions, "settings.business") ? <> The {cohorts.lapsedDays} days are set under <Link href={`/app/${slug}/settings/booking`} className="text-brand-700 underline">Settings → Booking rules</Link>.</> : null}
            </p>
          </div>
        </Card>
      ) : null}
      {/* min-w-0: a grid cell defaults to the width of its content, so a wide table would push the card past a phone's edge instead of scrolling inside it. */}
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {locations.length > 1 ? (
          <Card className="lg:col-span-2">
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">By location</h2>
            {locRows.length === 0 ? <div className="p-4"><Empty title="No closed sales in this range" /></div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500">
                  <tr>
                    <th className="py-2 pl-3 pr-2">Location</th><th className="px-2 py-2 text-right">Sales</th><th className="px-2 py-2 text-right">Services</th><th className="px-2 py-2 text-right">Products</th><th className="px-2 py-2 text-right">Tips</th><th className="px-2 py-2 text-right">Tax</th><th className="px-2 py-2 text-right">Refunded</th><th className="px-2 py-2 text-right">Tickets</th>
                    {payByLoc ? <><th className="px-2 py-2 text-right">Service commission</th><th className="px-2 py-2 text-right">Product commission</th><th className="px-2 py-2 text-right">Hourly / salary</th><th className="px-2 py-2 text-right">Total pay</th><th className="px-2 py-2 text-right">Cost of revenue</th></> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {locRows.map((r) => {
                    const lp = payByLoc?.get(r.locationId) ?? null;
                    return (
                      <tr key={r.locationId ?? "none"} className={r.locationId === locationFilter ? "bg-brand-50/40" : ""}>
                        <td className="whitespace-nowrap py-2 pl-3 pr-2"><Link href={`?from=${from}&to=${to}&location=${r.locationId ?? ""}`} className="hover:underline">{siteLabel(r.locationName)}</Link></td>
                        <td className="px-2 py-2 text-right">{money(r.sales)}</td><td className="px-2 py-2 text-right">{money(r.services)}</td><td className="px-2 py-2 text-right">{money(r.products)}</td><td className="px-2 py-2 text-right">{money(r.tips)}</td><td className="px-2 py-2 text-right">{money(r.tax)}</td><td className="px-2 py-2 text-right">{money(r.refunded)}</td><td className="px-2 py-2 text-right">{r.count}</td>
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
                      <td className="px-2 py-2 text-right">{money(locRows.reduce((n, r) => n + r.sales, 0))}</td><td className="px-2 py-2 text-right">{money(locRows.reduce((n, r) => n + r.services, 0))}</td><td className="px-2 py-2 text-right">{money(locRows.reduce((n, r) => n + r.products, 0))}</td><td className="px-2 py-2 text-right">{money(locRows.reduce((n, r) => n + r.tips, 0))}</td><td className="px-2 py-2 text-right">{money(locRows.reduce((n, r) => n + r.tax, 0))}</td><td className="px-2 py-2 text-right">{money(locRows.reduce((n, r) => n + r.refunded, 0))}</td><td className="px-2 py-2 text-right">{locRows.reduce((n, r) => n + r.count, 0)}</td>
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
        {can(permissions, "reports.staff") ? <Card className="lg:col-span-2">
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
                    <th className="py-2 pl-3 pr-2">Staff</th><th className="px-2 py-2 text-right">Services</th><th className="px-2 py-2 text-right">Products</th><th className="px-2 py-2 text-right">Tips</th><th className="px-2 py-2 text-right">Refunded</th>
                    {canPayroll ? <><th className="px-2 py-2 text-right">Service commission</th><th className="px-2 py-2 text-right">Product commission</th><th className="px-2 py-2 text-right">Hourly / salary</th><th className="px-2 py-2 text-right">Total pay</th><th className="px-2 py-2 text-right">Cost of revenue</th></> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {staffRows.map((r) => (
                    <tr key={r.staffId ?? "none"}>
                      <td className="whitespace-nowrap py-2 pl-3 pr-2"><span className="font-medium">{r.name}</span>{canPayroll && r.e ? <span className="block text-xs text-stone-500">{r.e.employee.payType === "commission" ? "Commission" : r.e.employee.payType === "hourly" ? "Hourly" : "Salary"}</span> : null}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(r.services)}</td><td className="px-2 py-2 text-right tabular-nums">{money(r.products)}</td><td className="px-2 py-2 text-right tabular-nums">{money(r.tips)}</td><td className="px-2 py-2 text-right tabular-nums">{money(r.refunded)}</td>
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
                    <td className="px-2 py-2 text-right tabular-nums">{money(staffRows.reduce((n, r) => n + r.services, 0))}</td><td className="px-2 py-2 text-right tabular-nums">{money(staffRows.reduce((n, r) => n + r.products, 0))}</td><td className="px-2 py-2 text-right tabular-nums">{money(staffRows.reduce((n, r) => n + r.tips, 0))}</td><td className="px-2 py-2 text-right tabular-nums">{money(staffRows.reduce((n, r) => n + r.refunded, 0))}</td>
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
        </Card> : null}
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
          {can(permissions, "settings.business") ? <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">Reasons are managed under <Link href={`/app/${slug}/settings/refund-reasons`} className="text-brand-700 underline">Settings → Refund reasons</Link>.</p> : null}
        </Card>
        {byItem.length ? (
          <Card className={scoped ? "hidden" : ""}>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Refunds by item</h2>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Item</th><th className="px-4 py-2 text-right">Refunds</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Total</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {byItem.slice(0, 20).map((r) => (
                  <tr key={`${r.kind}:${r.name}`}><td className="px-4 py-2">{r.name}</td><td className="px-4 py-2 text-right tabular-nums">{r.count}</td><td className="px-4 py-2 text-right tabular-nums">{r.quantity || ""}</td><td className="px-4 py-2 text-right font-medium tabular-nums">{money(r.cents)}</td></tr>
                ))}
              </tbody>
            </table></div>
          </Card>
        ) : null}
        <Card className={scoped ? "hidden" : ""}>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Cancellations by reason</h2>
          {cancels.length === 0 ? <div className="p-4"><Empty title="No cancellations in this range" /></div> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Reason</th><th className="px-4 py-2 text-right">Cancelled</th><th className="px-4 py-2 text-right">By client</th><th className="px-4 py-2 text-right">Inside window</th><th className="px-4 py-2 text-right">Booked value lost</th><th className="px-4 py-2 text-right">Deposits kept</th><th className="px-4 py-2 text-right">Fees collected</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {cancels.map((r) => (
                  <tr key={r.reasonId ?? "none"}><td className="px-4 py-2">{r.name}</td><td className="px-4 py-2 text-right tabular-nums">{r.count}</td><td className="px-4 py-2 text-right tabular-nums">{r.byClient}</td><td className="px-4 py-2 text-right tabular-nums">{r.lateCount}</td><td className="px-4 py-2 text-right tabular-nums">{money(r.lostCents)}</td><td className="px-4 py-2 text-right tabular-nums">{money(r.depositKeptCents)}</td><td className="px-4 py-2 text-right tabular-nums">{money(r.feeCents)}</td></tr>
                ))}
                <tr className="font-medium"><td className="px-4 py-2">Total</td><td className="px-4 py-2 text-right tabular-nums">{cancels.reduce((n, r) => n + r.count, 0)}</td><td className="px-4 py-2 text-right tabular-nums">{cancels.reduce((n, r) => n + r.byClient, 0)}</td><td className="px-4 py-2 text-right tabular-nums">{cancels.reduce((n, r) => n + r.lateCount, 0)}</td><td className="px-4 py-2 text-right tabular-nums">{money(cancels.reduce((n, r) => n + r.lostCents, 0))}</td><td className="px-4 py-2 text-right tabular-nums">{money(cancels.reduce((n, r) => n + r.depositKeptCents, 0))}</td><td className="px-4 py-2 text-right tabular-nums">{money(cancels.reduce((n, r) => n + r.feeCents, 0))}</td></tr>
              </tbody>
            </table></div>
          )}
          {can(permissions, "settings.business") ? <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">Reasons are managed under <Link href={`/app/${slug}/settings/cancellation-reasons`} className="text-brand-700 underline">Settings → Cancellation reasons</Link>. Cancellations made before reasons existed show as &quot;No reason given&quot;.</p> : null}
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
            <CategoryTable rows={catRows.map(toLine)} total={{ count: catTotal("count"), services: money(catTotal("paid")), prepaid: money(catTotal("credit")), total: money(serviceRevenue), ...(catPayTotal !== null ? { pay: money(catPayTotal), profit: money(serviceRevenue - catPayTotal) } : {}) }} periodLabel={periodLabel} />
          )}
          <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">
            Package and membership sessions count in the category of the service performed, at the session&apos;s value, on the day it is used. Package sales and membership fees are shown as Prepaid sold and are not category revenue.
            {" "}Service lines on paid tickets, by the service&apos;s category today; sub-categories are listed when a category has more than one.
            {catPayTotal !== null ? " Provider pay is the commission Payroll credits on these lines for these dates (visit date, that day's rates, discounts as set under Payroll rules), less refunds clawed back in the range; hourly and salary pay is not split by category. Profit is Total less Provider pay." : ""}
          </p>
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
          <div className="overflow-x-auto">
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
          </div>
        </Card>
      ) : null}
    </>
  );
}
