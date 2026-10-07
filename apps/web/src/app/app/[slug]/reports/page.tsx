import Link from "next/link";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { Download } from "lucide-react";

export const metadata: Metadata = { title: "Sales" };
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { salesReport } from "@/server/sales";
import { formatDateLong, formatMoney, shiftISODate } from "@/lib/utils";
import { Button, Card, Input, PageHeader, Empty, LinkButton } from "@/components/ui";

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "reports.view");
  const tz = business.timezone;
  const today = instantToISODate(new Date(), tz);
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(sp.from) ? sp.from! : today;
  const to = isDate(sp.to) ? sp.to! : from;
  const { sales, byStaff, byMethod, byService, appts } = await salesReport(business.id, zonedToInstant(from, "00:00", tz), zonedToInstant(shiftISODate(to, 1), "00:00", tz));
  const money = (c: number) => formatMoney(Number(c), business.currency);
  const sum = (k: "subtotalCents" | "discountCents" | "taxCents" | "tipCents" | "totalCents" | "refundedCents") => sales.reduce((s, r) => s + r[k], 0);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short", timeZone: tz });

  return (
    <>
      <PageHeader title="Sales">
        <form className="flex items-center gap-2">
          <Input type="date" name="from" defaultValue={from} className="w-40" />
          <span className="text-sm text-stone-500">to</span>
          <Input type="date" name="to" defaultValue={to} className="w-40" />
          <Button type="submit" variant="secondary" size="sm">Show</Button>
        </form>
        <LinkButton href={`?from=${today}&to=${today}`} size="sm">Today</LinkButton>
        <LinkButton href={`?from=${shiftISODate(today, -6)}&to=${today}`} size="sm">Last 7 days</LinkButton>
        <LinkButton href={`/app/${slug}/reports/export?kind=sales&from=${from}&to=${to}`} size="sm"><Download className="h-4 w-4" /> Sales CSV</LinkButton>
        <LinkButton href={`/app/${slug}/reports/export?kind=appointments&from=${from}&to=${to}`} size="sm"><Download className="h-4 w-4" /> Appointments CSV</LinkButton>
      </PageHeader>
      <p className="mb-4 text-sm text-stone-600">{from === to ? formatDateLong(from) : `${formatDateLong(from)} – ${formatDateLong(to)}`}</p>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Sales", sum("totalCents") - sum("tipCents")],
          ["Tips", sum("tipCents")],
          ["Discounts", sum("discountCents")],
          ["Tax collected", sum("taxCents")],
          ["Refunds", sum("refundedCents")],
        ].map(([label, v]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
            <p className="text-xl font-semibold">{money(Number(v))}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">By staff</h2>
          {byStaff.length === 0 ? <div className="p-4"><Empty title="No closed sales in this range" /></div> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Staff</th><th className="px-4 py-2 text-right">Services</th><th className="px-4 py-2 text-right">Products</th><th className="px-4 py-2 text-right">Tips</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {byStaff.map((r) => (
                  <tr key={r.staffId ?? "none"}><td className="px-4 py-2">{r.staffName ?? "Unassigned"}</td><td className="px-4 py-2 text-right">{money(r.services)}</td><td className="px-4 py-2 text-right">{money(r.products)}</td><td className="px-4 py-2 text-right">{money(r.tips)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">By payment method</h2>
          {byMethod.length === 0 ? <div className="p-4"><Empty title="No payments in this range" /></div> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Method</th><th className="px-4 py-2 text-right">Count</th><th className="px-4 py-2 text-right">Collected</th><th className="px-4 py-2 text-right">of which tips</th><th className="px-4 py-2 text-right">Refunded</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {byMethod.map((r) => (
                  <tr key={r.method}><td className="px-4 py-2 capitalize">{r.method.replace("_", " ")}</td><td className="px-4 py-2 text-right">{Number(r.count)}</td><td className="px-4 py-2 text-right">{money(r.amount)}</td><td className="px-4 py-2 text-right">{money(r.tips)}</td><td className="px-4 py-2 text-right">{money(r.refunded)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Top services &amp; products</h2>
          {byService.length === 0 ? <div className="p-4"><Empty title="Nothing sold in this range" /></div> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">Item</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Revenue</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {byService.map((r) => <tr key={`${r.kind}:${r.name}`}><td className="px-4 py-2">{r.name} <span className="text-xs text-stone-400">{r.kind}</span></td><td className="px-4 py-2 text-right">{Number(r.count)}</td><td className="px-4 py-2 text-right">{money(r.amount)}</td></tr>)}
              </tbody>
            </table>
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
              <table className="w-full text-sm">
                <tbody className="divide-y divide-stone-100">
                  {rows.map(([l, n]) => <tr key={l}><td className="px-4 py-2">{l}</td><td className="px-4 py-2 text-right">{n}</td><td className="px-4 py-2 text-right text-stone-500">{total ? Math.round((n / total) * 100) : 0}%</td></tr>)}
                  <tr className="font-medium"><td className="px-4 py-2">Total</td><td className="px-4 py-2 text-right">{total}</td><td /></tr>
                </tbody>
              </table>
            );
          })()}
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Closed sales</h2>
          {sales.length === 0 ? <div className="p-4"><Empty title="Nothing closed in this range" /></div> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">#</th><th className="px-4 py-2">When</th><th className="px-4 py-2">Client</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2 text-right">Tips</th><th className="px-4 py-2">Status</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2"><Link href={`/app/${slug}/sales/${s.id}`} className="text-brand-700 underline">{s.number}</Link></td>
                    <td className="px-4 py-2">{s.closedAt ? fmt.format(s.closedAt) : ""}</td>
                    <td className="px-4 py-2">{s.clientFirst ? `${s.clientFirst} ${s.clientLast ?? ""}` : "Walk-in"}</td>
                    <td className="px-4 py-2 text-right">{money(s.totalCents)}</td>
                    <td className="px-4 py-2 text-right">{money(s.tipCents)}</td>
                    <td className="px-4 py-2"><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
