import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, Empty, Input, LinkButton, PageHeader } from "@/components/ui";
import { LocationFilter } from "@/components/location-filter";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { StackTable } from "@/components/stack-table";
import { PrintButton } from "@/app/print/forms/[slug]/[submissionId]/print-button";
import { listLocations } from "@/server/locations";
import { closingDay } from "@/server/drawer";
import { paymentMethodLabel } from "@/lib/payment-methods";
import { formatDateLong, formatMoney, formatTime, shiftISODate } from "@/lib/utils";
import { siteLabels } from "@/lib/location-ui";
import { pickLocation } from "../../drawer/data";
import { OverShort } from "../../drawer/panel";

export const metadata: Metadata = { title: "Closing report" };

const PROVIDER_LABEL: Record<string, string> = { stripe: "Stripe", helcim: "Helcim" };

export default async function ClosingReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ location?: string; date?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "reports.view");
  const tz = business.timezone;
  const currency = business.currency;
  const money = (c: number) => formatMoney(c, currency);
  const locations = await listLocations(business.id);
  const loc = pickLocation(locations, sp.location);
  const today = instantToISODate(new Date(), tz);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const base = `/app/${slug}`;
  if (!loc) return <Empty title="Add a location first" body="The closing report is per location." action={{ href: `${base}/settings/locations`, label: "Locations" }} />;
  const r = await closingDay(business.id, loc.id, zonedToInstant(date, "00:00", tz), zonedToInstant(shiftISODate(date, 1), "00:00", tz));
  const multi = locations.length > 1;
  const qs = (over: { date?: string }) => {
    const p = new URLSearchParams();
    if (multi) p.set("location", loc.id);
    const d = over.date ?? date;
    if (d !== today) p.set("date", d);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const exportHref = `${base}/reports/closing/export?location=${loc.id}&date=${date}`;
  const ownTerminal = r.methods.find((m) => m.method === "external_card");
  const nothing = !r.totals.count && !r.tickets.count && !r.totals.refundsCents && !r.deposits.count && !r.openTickets.length && !r.drawers.length;
  const th = "px-4 py-2";
  const num = "px-4 py-2 text-right tabular-nums";

  return (
    <div className="closing-report">
      <div className="print:hidden"><BackLink href={`${base}/reports`}>Reports</BackLink></div>
      <PageHeader title="Closing report">
        <PrintButton />
        <LinkButton href={exportHref} size="sm"><Download className="h-4 w-4" /> CSV</LinkButton>
      </PageHeader>
      <p className="-mt-3 mb-4 text-sm text-stone-600">{business.name}{multi ? ` · ${siteLabels(locations).get(loc.id)}` : ""} · {formatDateLong(date)}</p>

      <Card className="mb-4 p-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href={`${base}/reports/closing${qs({ date: shiftISODate(date, -1) })}`} size="sm"><ChevronLeft className="h-4 w-4" /><span className="sr-only">Previous day</span></LinkButton>
          <LinkButton href={`${base}/reports/closing${qs({ date: today })}`} size="sm" variant={date === today ? "ghost" : "secondary"}>Today</LinkButton>
          <LinkButton href={`${base}/reports/closing${qs({ date: shiftISODate(date, 1) })}`} size="sm"><ChevronRight className="h-4 w-4" /><span className="sr-only">Next day</span></LinkButton>
          <AutoSubmitForm className="flex items-center gap-2">
            {multi ? <input type="hidden" name="location" value={loc.id} /> : null}
            <Input type="date" name="date" defaultValue={date} aria-label="Day" className="h-9 w-auto" />
          </AutoSubmitForm>
          {multi ? <LocationFilter locations={locations} current={loc.id} query={date !== today ? `date=${date}` : ""} allLabel={null} /> : null}
        </div>
      </Card>

      {nothing ? (
        <Empty title="Nothing taken on this day" body="Payments, refunds and closed tickets at this location show here once there are some." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4"><p className="text-xs text-stone-500">Collected, after refunds</p><p className="text-xl font-semibold tabular-nums" data-testid="net">{money(r.totals.netCents)}</p></Card>
            <Card className="p-4"><p className="text-xs text-stone-500">Tickets closed</p><p className="text-xl font-semibold tabular-nums">{r.tickets.count}</p></Card>
            <Card className="p-4"><p className="text-xs text-stone-500">Tips</p><p className="text-xl font-semibold tabular-nums">{money(r.tickets.tipCents)}</p></Card>
            <Card className="p-4"><p className="text-xs text-stone-500">Refunds</p><p className="text-xl font-semibold tabular-nums">{money(r.totals.refundsCents)}</p></Card>
          </div>

          <Card className="break-inside-avoid">
            <h2 className="border-b border-stone-200 px-4 py-3 font-semibold text-stone-800">Payments by method</h2>
            <div className="overflow-x-auto">
              <StackTable className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500">
                  <tr><th className={th}>Method</th><th className={`${th} text-right`}>Payments</th><th className={`${th} text-right`}>Taken</th><th className={`${th} text-right`}>Tips</th><th className={`${th} text-right`}>Refunds</th><th className={`${th} text-right`}>Net</th></tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {r.methods.map((m) => (
                    <tr key={m.method}>
                      <td className={`${th} font-medium`}>{paymentMethodLabel(m.method)}</td>
                      <td className={num}>{m.count}</td>
                      <td className={num}>{money(m.amountCents)}</td>
                      <td className={num}>{money(m.tipsCents)}</td>
                      <td className={num}>{m.refundsCents ? `− ${money(m.refundsCents)}` : money(0)}</td>
                      <td className={`${num} font-medium`}>{money(m.netCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-stone-200 font-semibold">
                  <tr><td className={th}>Total</td><td className={num}>{r.totals.count}</td><td className={num}>{money(r.totals.amountCents)}</td><td className={num}>{money(r.totals.tipsCents)}</td><td className={num}>{r.totals.refundsCents ? `− ${money(r.totals.refundsCents)}` : money(0)}</td><td className={num}>{money(r.totals.netCents)}</td></tr>
                </tfoot>
              </StackTable>
            </div>
            <p className="px-4 pb-3 text-xs text-stone-500">Taken counts payments made on the day. Tips are those on tickets closed on the day, by how they were paid. Gift cards, store credit and points are balances used, not new money.</p>
          </Card>

          {r.processors.length || ownTerminal ? (
            <Card className="break-inside-avoid">
              <h2 className="border-b border-stone-200 px-4 py-3 font-semibold text-stone-800">Card totals to match your payout</h2>
              <div className="overflow-x-auto">
                <StackTable className="w-full text-sm">
                  <thead className="text-left text-xs text-stone-500">
                    <tr><th className={th}>Processor</th><th className={`${th} text-right`}>Charged at the desk</th><th className={`${th} text-right`}>Online deposits</th><th className={`${th} text-right`}>Refunds</th><th className={`${th} text-right`}>Net, before fees</th></tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {r.processors.map((p) => (
                      <tr key={p.provider}>
                        <td className={`${th} font-medium`}>{PROVIDER_LABEL[p.provider] ?? p.provider}</td>
                        <td className={num}>{money(p.chargedCents)}</td>
                        <td className={num}>{money(p.depositsCents)}</td>
                        <td className={num}>{p.refundsCents ? `− ${money(p.refundsCents)}` : money(0)}</td>
                        <td className={`${num} font-medium`}>{money(p.netCents)}</td>
                      </tr>
                    ))}
                    {ownTerminal ? (
                      <tr>
                        <td className={`${th} font-medium`}>{paymentMethodLabel("external_card")}</td>
                        <td className={num}>{money(ownTerminal.amountCents)}</td>
                        <td className={num}>—</td>
                        <td className={num}>{ownTerminal.refundsCents ? `− ${money(ownTerminal.refundsCents)}` : money(0)}</td>
                        <td className={`${num} font-medium`}>{money(ownTerminal.netCents)}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </StackTable>
              </div>
              <p className="px-4 pb-3 text-xs text-stone-500">A deposit is counted on the day it was charged online, not when it is applied at checkout. The processor pays out less its fees, often a day or two later.{ownTerminal ? " Match Card (own terminal) against that terminal's batch report." : ""}</p>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="break-inside-avoid">
              <h2 className="border-b border-stone-200 px-4 py-3 font-semibold text-stone-800">Tickets closed</h2>
              <dl className="divide-y divide-stone-100 text-sm">
                {([
                  ["Services", r.tickets.servicesCents],
                  ["Products", r.tickets.productsCents],
                  ["Packages, memberships, gift cards and fees", r.tickets.otherCents],
                  ["Discounts", r.tickets.discountCents ? -r.tickets.discountCents : 0],
                  ["Tax", r.tickets.taxCents],
                  ["Tips", r.tickets.tipCents],
                ] as const).map(([label, cents]) => (
                  <div key={label} className="flex justify-between px-4 py-2"><dt className="text-stone-600">{label}</dt><dd className="tabular-nums">{cents < 0 ? `− ${money(-cents)}` : money(cents)}</dd></div>
                ))}
                <div className="flex justify-between bg-stone-50 px-4 py-2.5 font-semibold"><dt>Total ({r.tickets.count} {r.tickets.count === 1 ? "ticket" : "tickets"})</dt><dd className="tabular-nums">{money(r.tickets.totalCents)}</dd></div>
              </dl>
            </Card>

            <Card className="break-inside-avoid">
              <h2 className="border-b border-stone-200 px-4 py-3 font-semibold text-stone-800">Cash drawer</h2>
              {r.drawers.length ? (
                <ul className="divide-y divide-stone-100 text-sm">
                  {r.drawers.map((d) => (
                    <li key={d.s.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <Link href={`${base}/drawer/${d.s.id}`} className="font-medium hover:underline">{d.s.register === "Main" ? "Drawer" : d.s.register}</Link>
                        <p className="text-xs text-stone-500">Closed {formatTime(d.s.closedAt!, tz)}{d.closedByName ? ` by ${d.closedByName}` : ""} · counted {money(d.s.countedCents ?? 0)} of {money(d.s.expectedCents ?? 0)}</p>
                      </div>
                      <OverShort cents={d.s.overShortCents ?? 0} currency={currency} className="text-sm" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-3 text-sm text-stone-500">No drawer was closed on this day.</p>
              )}
              {r.unstampedCashCents ? <p className="border-t border-stone-100 px-4 py-2 text-xs text-amber-700">{money(r.unstampedCashCents)} in cash was taken while no drawer was open, so no count covers it.</p> : null}
              <div className="border-t border-stone-100 px-4 py-2 text-sm">
                <div className="flex justify-between"><span className="text-stone-600">Deposits taken online ({r.deposits.count})</span><span className="tabular-nums">{money(r.deposits.amountCents)}</span></div>
              </div>
            </Card>
          </div>

          <Card className="break-inside-avoid">
            <h2 className="border-b border-stone-200 px-4 py-3 font-semibold text-stone-800">Open tickets still unpaid</h2>
            {r.openTickets.length ? (
              <ul className="divide-y divide-stone-100 text-sm">
                {r.openTickets.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Link href={`${base}/sales/${t.id}`} className="min-w-0 flex-1 font-medium hover:underline">#{t.number} · {t.clientName}</Link>
                    <span className="text-xs text-stone-500">opened {formatDateLong(instantToISODate(t.createdAt, tz))}</span>
                    <span className="w-24 text-right tabular-nums">{money(t.dueCents)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-stone-500">None. Every ticket opened by the end of this day is paid.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
