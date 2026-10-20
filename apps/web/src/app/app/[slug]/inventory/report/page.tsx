import type { Metadata } from "next";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { inventoryReport, supplyCosts } from "@/server/inventory";
import { MOVEMENT_REASONS, productLabel } from "@/lib/inventory";
import { dateLong } from "@/lib/format";
import { formatMoney } from "@/lib/utils";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Report · Inventory" };

const WINDOWS = [30, 90, 180, 365];

export default async function InventoryReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ days?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "inventory.manage");
  const days = WINDOWS.includes(Number(sp.days)) ? Number(sp.days) : 90;
  const [r, sc] = await Promise.all([inventoryReport(business.id, days), supplyCosts(business.id, days)]);
  const money = (c: number) => formatMoney(c, business.currency);
  const maxValue = Math.max(1, ...r.history.map((h) => h.valueCents));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">How stock behaved over the last {days} days. Sales and back-bar use count as movement.</p>
        <div data-segmented className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="Period">
          {WINDOWS.map((d) => <Link key={d} href={`?days=${d}`} aria-current={d === days ? "true" : undefined} className={`rounded-md px-3 py-0.5 ${d === days ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50"}`}>{d} days</Link>)}
        </div>
      </div>

      <Section title="Cost of what left the shelf" note={`Sold to clients ${money(r.soldCostCents)} · used in services ${money(r.usedCostCents)} at what each unit cost when it left, over the last ${days} days.`}>
        {r.costSplit.length === 0 ? <None>Nothing sold or used in this period.</None> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-1.5">Product</th><th className="px-2 py-1.5 text-right">Sold</th><th className="px-2 py-1.5 text-right">Cost of sold</th><th className="px-2 py-1.5 text-right">Used</th><th className="px-4 py-1.5 text-right">Cost of used</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {r.costSplit.slice(0, 20).map((c) => (
                <tr key={c.productId}>
                  <td className="px-4 py-1.5"><Link href={`/app/${slug}/products/${c.productId}`} className="font-medium hover:underline">{c.name}</Link>{c.soldUnits && c.usedUnits ? <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800">sold and used</span> : null}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.soldUnits || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.soldUnits ? money(c.soldCostCents) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.usedUnits || "—"}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{c.usedUnits ? money(c.usedCostCents) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Supplies by service" note={sc.visits ? `Supplies were logged on ${sc.visitsWithSupplies} of ${sc.visits} visits in the last ${days} days. Averages use only visits where supplies were logged, so log them on the visit to make this complete.${sc.untiedCents ? ` ${money(sc.untiedCents)} more was logged without a visit.` : ""}` : undefined}>
        {sc.services.filter((x) => x.logged).length === 0 ? <None>No supplies have been logged on a visit in this period. Log them on the appointment (the "Supplies used" card) to see what each service costs.</None> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-1.5">Service</th><th className="px-2 py-1.5 text-right">Visits logged</th><th className="px-2 py-1.5 text-right">Supplies</th><th className="px-2 py-1.5 text-right">Per visit</th><th className="px-2 py-1.5 text-right">Price</th><th className="px-4 py-1.5 text-right">% of price</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {sc.services.filter((x) => x.logged).slice(0, 20).map((x) => (
                <tr key={x.id}>
                  <td className="px-4 py-1.5 font-medium">{x.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-stone-600">{x.logged}{x.completed ? <span className="text-stone-400"> / {x.completed}</span> : null}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(x.costCents)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(x.avgPerLoggedCents)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-stone-600">{x.avgPriceCents ? money(x.avgPriceCents) : "—"}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{x.avgPriceCents ? `${Math.round((x.avgPerLoggedCents / x.avgPriceCents) * 100)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Supplies by stylist" note="Average supplies on a visit where they logged any, against the team's average. A stylist well above it may be using more, or logging more.">
        {sc.staff.filter((x) => x.logged).length === 0 ? <None>Nothing logged against visits yet.</None> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-1.5">Stylist</th><th className="px-2 py-1.5 text-right">Visits logged</th><th className="px-2 py-1.5 text-right">Supplies</th><th className="px-2 py-1.5 text-right">Per visit</th><th className="px-4 py-1.5 text-right">vs team</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {sc.staff.filter((x) => x.logged).map((x) => {
                const ratio = sc.teamAvgPerLoggedVisitCents ? x.avgPerLoggedCents / sc.teamAvgPerLoggedVisitCents : 1;
                return (
                  <tr key={x.id}>
                    <td className="px-4 py-1.5 font-medium">{x.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-stone-600">{x.logged}{x.completed ? <span className="text-stone-400"> / {x.completed}</span> : null}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(x.costCents)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(x.avgPerLoggedCents)}</td>
                    <td className={`px-4 py-1.5 text-right tabular-nums ${ratio >= 1.5 ? "font-medium text-amber-700" : "text-stone-600"}`}>{x.logged < 3 ? "too few" : `${ratio >= 1 ? "+" : "−"}${Math.abs(Math.round((ratio - 1) * 100))}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Running out" note="At the pace of the last period, these have 30 days or less left.">
        {r.runningOut.length === 0 ? <None>Nothing is about to run out.</None> : r.runningOut.map((p) => (
          <Row key={p.id} href={`/app/${slug}/products/${p.id}`} left={productLabel(p)} sub={`${p.stockQty} on hand · ${(p.perWeek).toFixed(1)} a week`} right={p.daysLeft === 0 ? "out" : `${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"} left`} tone={(p.daysLeft ?? 0) <= 7 ? "text-red-700" : "text-amber-700"} />
        ))}
      </Section>

      <Section title="Best movers" note="Most units sold or used.">
        {r.sellers.length === 0 ? <None>Nothing sold or used in this period.</None> : r.sellers.slice(0, 10).map((p) => (
          <Row key={p.id} href={`/app/${slug}/products/${p.id}`} left={productLabel(p)} sub={`${p.sold} sold${p.used ? ` · ${p.used} used in services` : ""} · ${p.stockQty} on hand`} right={`${p.perWeek.toFixed(1)} / week`} />
        ))}
      </Section>

      <Section title="Not moving" note={`On the shelf but not sold or used in ${days} days. ${r.dead.length ? `${money(r.deadValueCents)} at cost is tied up.` : ""}`}>
        {r.dead.length === 0 ? <None>Everything on the shelf has moved.</None> : r.dead.slice(0, 15).map((p) => (
          <Row key={p.id} href={`/app/${slug}/products/${p.id}`} left={productLabel(p)} sub={p.lastMoved ? `last moved ${dateLong(new Date(p.lastMoved).toISOString().slice(0, 10))}` : "never moved"} right={`${p.stockQty} · ${p.costCents ? money(p.valueCents) : "no cost set"}`} />
        ))}
      </Section>

      <Section title="Lost to damage, theft and expiry" note={r.shrinkTotalCents ? `${money(r.shrinkTotalCents)} at cost in the last ${days} days.` : undefined}>
        {r.shrinkByProduct.length === 0 ? <None>Nothing written off in this period.</None> : (
          <>
            <div className="flex flex-wrap gap-4 border-b border-stone-100 px-4 py-2 text-sm">
              {r.shrinkByReason.filter((x) => x.units).map((x) => <span key={x.reason}><span className="text-stone-500">{MOVEMENT_REASONS[x.reason as keyof typeof MOVEMENT_REASONS]}</span> {x.units} unit{x.units === 1 ? "" : "s"} · {money(x.valueCents)}</span>)}
            </div>
            {r.shrinkByProduct.slice(0, 15).map((p) => <Row key={p.productId} href={`/app/${slug}/products/${p.productId}`} left={p.name} sub={`${p.units} unit${p.units === 1 ? "" : "s"}`} right={money(p.valueCents)} />)}
          </>
        )}
      </Section>

      <Section title="Value on the shelf" note="At cost, at today's unit costs, at the end of each month.">
        <ul className="space-y-1.5 px-4 py-3 text-sm">
          {r.history.map((h) => (
            <li key={h.label} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-3">
              <span className="text-stone-600">{h.label}</span>
              <span className="h-2 rounded bg-stone-100"><span className="block h-2 rounded bg-brand-500" style={{ width: `${Math.max(2, (h.valueCents / maxValue) * 100)}%` }} /></span>
              <span className="text-right tabular-nums">{money(h.valueCents)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="border-b border-stone-200 px-4 py-2">
        <h2 className="text-sm font-semibold text-stone-600">{title}</h2>
        {note ? <p className="text-xs text-stone-500">{note}</p> : null}
      </div>
      <div className="divide-y divide-stone-100 overflow-x-auto">{children}</div>
    </Card>
  );
}
const None = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-3 text-sm text-stone-500">{children}</p>;
function Row({ href, left, sub, right, tone }: { href: string; left: string; sub?: string; right: string; tone?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      <div className="min-w-0 flex-1"><Link href={href} className="font-medium hover:underline">{left}</Link>{sub ? <p className="truncate text-xs text-stone-500">{sub}</p> : null}</div>
      <span className={`shrink-0 tabular-nums ${tone ?? "text-stone-700"}`}>{right}</span>
    </div>
  );
}
