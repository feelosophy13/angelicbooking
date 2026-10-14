import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { historyPeople, listLocations, stockHistory } from "@/server/inventory";
import { MOVEMENT_REASONS, REASON_GROUPS, REASON_GROUP_LABELS, movementReason } from "@/lib/inventory";
import { HISTORY_RANGES, historyFilterFromParams, type HistoryParams } from "@/lib/history-filter";
import { dateTime } from "@/lib/format";
import { formatMoney } from "@/lib/utils";
import { Card, Empty, Input, LinkButton, Select } from "@/components/ui";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { rowClass, rowControl, RowLink } from "@/components/row";
import { Download } from "lucide-react";

export const metadata: Metadata = { title: "History · Inventory" };

/** Every change to stock, newest first: what moved, how many, why, where, who, and the sale, order or visit behind it. */
export default async function StockHistoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<HistoryParams> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "inventory.manage");
  const { filter, page, range, fromDate, toDate } = historyFilterFromParams(sp, business.timezone);
  const [h, people, locations] = await Promise.all([stockHistory(business.id, filter, page), historyPeople(business.id), listLocations(business.id)]);
  const money = (c: number) => formatMoney(c, business.currency);
  const multi = locations.length > 1;
  const shortLoc = (n: string | null) => n?.replace(`${business.name} - `, "") ?? "";
  const pages = Math.max(1, Math.ceil(h.total / h.pageSize));
  // A page number past the end (the list shrank, or a stale link): go to the last page.
  if (h.page > pages) redirect(`/app/${slug}/inventory/history?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), page: String(pages) })}`);
  const keep = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) q.set(k, String(v));
    const s = q.toString();
    return s ? `?${s}` : "?";
  };
  const exportQuery = keep({ page: "" });
  const filtered = !!(sp.reason || sp.who || sp.loc || sp.product || sp.q);
  const productName = sp.product ? (h.rows[0]?.label ?? null) : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">Every change to stock, with the reason and who made it. An undo is kept as its own line so nothing is ever rewritten.</p>
        <LinkButton href={`/app/${slug}/inventory/history/export${exportQuery}`} variant="secondary" size="sm"><Download className="h-4 w-4" /> Export CSV</LinkButton>
      </div>

      <AutoSubmitForm className="flex flex-wrap items-center gap-2">
        {sp.product ? <input type="hidden" name="product" value={sp.product} /> : null}
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search product, code or note" aria-label="Search" className="h-9 w-56" />
        <Select name="range" defaultValue={range} aria-label="Period" className="h-9 w-auto">
          {HISTORY_RANGES.map((r) => <option key={r.value} value={r.value}>{r.value === "all" ? r.label : `Last ${r.label}`}</option>)}
          <option value="custom">Custom dates…</option>
        </Select>
        {range === "custom" ? (
          <>
            <Input type="date" name="from" defaultValue={fromDate ?? ""} aria-label="From" className="h-9 w-auto" />
            <span className="text-sm text-stone-500">to</span>
            <Input type="date" name="to" defaultValue={toDate ?? ""} aria-label="To" className="h-9 w-auto" />
          </>
        ) : null}
        <Select name="reason" defaultValue={sp.reason ?? ""} aria-label="Reason" className="h-9 w-auto">
          <option value="">Every reason</option>
          {(Object.keys(REASON_GROUPS) as (keyof typeof REASON_GROUPS)[]).map((g) => (
            <optgroup key={g} label={REASON_GROUP_LABELS[g]}>
              <option value={g}>All {REASON_GROUP_LABELS[g].toLowerCase()}</option>
              {REASON_GROUPS[g].map((r) => <option key={r} value={r}>{MOVEMENT_REASONS[r]}</option>)}
            </optgroup>
          ))}
        </Select>
        <Select name="who" defaultValue={sp.who ?? ""} aria-label="Person" className="h-9 w-auto">
          <option value="">Anyone</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="none">Nobody (automatic)</option>
        </Select>
        {multi ? (
          <Select name="loc" defaultValue={sp.loc ?? ""} aria-label="Location" className="h-9 w-auto">
            <option value="">All locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{shortLoc(l.name)}</option>)}
          </Select>
        ) : null}
        {filtered ? <Link href={`/app/${slug}/inventory/history`} className="text-sm text-stone-600 underline">Clear</Link> : null}
      </AutoSubmitForm>
      {sp.product ? <p className="text-sm text-stone-600">Showing one product{productName ? `: ${productName}` : ""}. <Link href={`/app/${slug}/inventory/history${keep({ product: "", page: "" })}`} className="underline">Show all products</Link></p> : null}

      {h.total === 0 ? (
        <Empty title="No stock changes match" body="Try a longer period or clear a filter." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Units in" value={`+${h.unitsIn}`} sub={`${money(h.valueInCents)} at cost`} tone="text-emerald-700" />
            <Stat label="Units out" value={`−${h.unitsOut}`} sub={`${money(h.valueOutCents)} at cost`} tone="text-red-700" />
            <Stat label="Net change" value={`${h.unitsIn - h.unitsOut > 0 ? "+" : h.unitsIn - h.unitsOut < 0 ? "−" : ""}${Math.abs(h.unitsIn - h.unitsOut)}`} sub={`${money(Math.abs(h.valueInCents - h.valueOutCents))} at cost`} />
            <Stat label="Lines" value={String(h.total)} sub={pages > 1 ? `page ${h.page} of ${pages}` : undefined} />
          </div>
          <Card>
            <ul className="divide-y divide-stone-100">
              {h.rows.map((m) => (
                <li key={m.id} className={`${rowClass} flex items-start gap-3 px-4 py-2 text-sm`}>
                  <span className={`w-12 shrink-0 text-right text-base font-semibold tabular-nums ${m.delta >= 0 ? "text-emerald-700" : "text-red-700"}`}>{m.delta > 0 ? "+" : m.delta < 0 ? "−" : ""}{Math.abs(m.delta)}</span>
                  <div className="min-w-0 flex-1">
                    <RowLink href={`/app/${slug}/products/${m.productId}`} className="font-medium">{m.label}</RowLink>
                    <p className="text-xs text-stone-500">
                      {movementReason(m.reason)}
                      {multi && m.location ? ` · ${shortLoc(m.location)}` : ""}
                      {m.who ? ` · ${m.who}` : ""}
                      {m.note ? ` · ${m.note}` : ""}
                      {m.reversesMovementId ? " · takes back an earlier line" : ""}
                      {m.undone ? " · undone" : ""}
                    </p>
                    {m.saleId || m.purchaseOrderId || m.appointmentId ? (
                      <p className="text-xs">
                        {m.saleId && m.saleNumber != null ? <Link href={`/app/${slug}/sales/${m.saleId}`} className={`${rowControl} text-brand-700 underline`}>Sale #{m.saleNumber}</Link> : null}
                        {m.purchaseOrderId && m.orderNumber != null ? <Link href={`/app/${slug}/inventory/orders/${m.purchaseOrderId}`} className={`${rowControl} text-brand-700 underline`}>Order #{m.orderNumber}</Link> : null}
                        {m.appointmentId ? <Link href={`/app/${slug}/appointments/${m.appointmentId}`} className={`${rowControl} ml-2 text-brand-700 underline`}>Visit</Link> : null}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-stone-500">{dateTime(m.createdAt, business.timezone)}</span>
                </li>
              ))}
            </ul>
          </Card>
          {pages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              {h.page > 1 ? <Link href={keep({ page: String(h.page - 1) })} className="underline">Newer</Link> : <span />}
              <span className="text-stone-500">Page {h.page} of {pages}</span>
              {h.page < pages ? <Link href={keep({ page: String(h.page + 1) })} className="underline">Older</Link> : <span />}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone ?? "text-stone-900"}`}>{value}</p>
      {sub ? <p className="text-xs text-stone-500">{sub}</p> : null}
    </Card>
  );
}
