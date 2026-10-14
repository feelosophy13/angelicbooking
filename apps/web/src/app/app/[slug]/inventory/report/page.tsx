import type { Metadata } from "next";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { inventoryReport } from "@/server/inventory";
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
  const r = await inventoryReport(business.id, days);
  const money = (c: number) => formatMoney(c, business.currency);
  const maxValue = Math.max(1, ...r.history.map((h) => h.valueCents));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">How stock behaved over the last {days} days. Sales and back-bar use count as movement.</p>
        <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="Period">
          {WINDOWS.map((d) => <Link key={d} href={`?days=${d}`} aria-current={d === days ? "true" : undefined} className={`rounded-md px-3 py-0.5 ${d === days ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50"}`}>{d} days</Link>)}
        </div>
      </div>

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
      <div className="divide-y divide-stone-100">{children}</div>
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
