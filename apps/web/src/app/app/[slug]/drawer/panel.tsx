import Link from "next/link";
import { DENOMINATIONS } from "@angelic/core";
import { Card } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { Disclosure } from "@/components/disclosure";
import { cn, formatMoney, formatTime } from "@/lib/utils";
import type { DrawerDetail } from "@/server/drawer";
import { CloseDrawerForm, MovementForm } from "./forms";
import { removeDrawerMovementAction } from "./actions";

const KIND_LABEL = { pay_in: "Pay-in", payout: "Payout", tip_payout: "Tip paid out" } as const;

/** "$4.00 over" / "$2.50 short" / "Balances", colored by how far off it is. */
export function OverShort({ cents, currency, className }: { cents: number; currency: string; className?: string }) {
  const off = Math.abs(cents);
  return (
    <span className={cn("tabular-nums", cents === 0 ? "text-emerald-700" : off > 100 ? "font-semibold text-red-700" : "text-amber-700", className)}>
      {cents === 0 ? "Balances" : `${formatMoney(off, currency)} ${cents > 0 ? "over" : "short"}`}
    </span>
  );
}

/** One drawer: what it should hold and why, cash in and out, and the count (or its result once closed). */
export function DrawerPanel({ d, slug, currency, tz, canManage, staff }: { d: DrawerDetail; slug: string; currency: string; tz: string; canManage: boolean; staff: { id: string; name: string }[] }) {
  const money = (c: number) => formatMoney(c, currency);
  const open = d.status === "open";
  const f = d.flows;
  const lines: [string, number, string][] = [
    ["Opening float", f.openingFloatCents, ""],
    ["Cash taken", f.cashSalesCents, "+"],
    ["Cash refunded", f.cashRefundsCents, "−"],
    ["Cash tips paid out", f.tipPayoutsCents, "−"],
    ["Pay-ins", f.payInsCents, "+"],
    ["Payouts", f.payoutsCents, "−"],
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-6">
        <Card>
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="font-semibold text-stone-800">{open ? "Should be in the drawer" : "Expected at close"}</h2>
            <p className="text-xs text-stone-500">
              Opened {formatTime(d.openedAt, tz)}{d.openedByName ? ` by ${d.openedByName}` : ""}
              {d.closedAt ? ` · closed ${formatTime(d.closedAt, tz)}${d.closedByName ? ` by ${d.closedByName}` : ""}` : ""}
            </p>
          </div>
          <dl className="divide-y divide-stone-100 text-sm">
            {lines.map(([label, cents, sign]) => (
              <div key={label} className="flex items-center justify-between px-4 py-2">
                <dt className="text-stone-600">{label}</dt>
                <dd className="tabular-nums text-stone-800">{sign && cents ? `${sign} ` : ""}{money(cents)}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between bg-stone-50 px-4 py-2.5 font-semibold">
              <dt>Expected cash</dt>
              <dd className="tabular-nums" data-testid="expected">{money(d.expectedCents)}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="font-semibold text-stone-800">Cash in and out</h2>
          </div>
          {d.movements.length ? (
            <ul className="divide-y divide-stone-100 text-sm">
              {d.movements.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-stone-800">{KIND_LABEL[m.kind]}{m.staffName ? ` · ${m.staffName}` : ""}</div>
                    <div className="truncate text-xs text-stone-500">{m.reason} · {formatTime(m.createdAt, tz)}{m.byName ? ` · ${m.byName}` : ""}</div>
                  </div>
                  <div className="w-24 shrink-0 text-right tabular-nums">{m.kind === "pay_in" ? "+" : "−"} {money(m.amountCents)}</div>
                  {open && canManage ? (
                    <form action={removeDrawerMovementAction} className="print:hidden">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="movementId" value={m.id} />
                      <ConfirmSubmit title="Remove this entry?" body={`${KIND_LABEL[m.kind]} of ${money(m.amountCents)}: ${m.reason}`} confirmLabel="Remove" variant="ghost">Remove</ConfirmSubmit>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-stone-500">No pay-ins or payouts{open ? " yet" : ""}.</p>
          )}
          {open && canManage ? (
            <div className="border-t border-stone-100 p-3 print:hidden">
              <Disclosure variant="inset" title="Record a payout or pay-in" hint="Petty cash, a change run, a tip paid in cash">
                <MovementForm slug={slug} sessionId={d.id} currency={currency} staff={staff} />
              </Disclosure>
            </div>
          ) : null}
        </Card>

        {d.pays.length || d.refunds.length ? (
          <Disclosure title={`Cash tickets (${d.pays.length})`} hint={money(f.cashSalesCents)}>
            <ul className="divide-y divide-stone-100 text-sm">
              {d.pays.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <Link href={`/app/${slug}/sales/${p.saleId}`} className="min-w-0 flex-1 text-stone-800 hover:underline">Ticket #{p.number}</Link>
                  <span className="text-xs text-stone-500">{formatTime(p.createdAt, tz)}</span>
                  <span className="w-24 text-right tabular-nums">{money(p.amountCents)}</span>
                </li>
              ))}
              {d.refunds.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <Link href={`/app/${slug}/sales/${r.saleId}`} className="min-w-0 flex-1 text-stone-800 hover:underline">Refund on ticket #{r.number}</Link>
                  <span className="text-xs text-stone-500">{formatTime(r.createdAt, tz)}</span>
                  <span className="w-24 text-right tabular-nums">− {money(r.amountCents)}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </div>

      <div className="space-y-6">
        {open ? (
          canManage ? (
            <Card className="p-4">
              <h2 className="mb-3 font-semibold text-stone-800">Count and close</h2>
              <CloseDrawerForm slug={slug} sessionId={d.id} currency={currency} expectedCents={d.expectedCents} />
            </Card>
          ) : null
        ) : (
          <Card className="p-4">
            <h2 className="mb-3 font-semibold text-stone-800">Close-out</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-stone-600">Expected</dt><dd className="tabular-nums">{money(d.expectedCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-600">Counted</dt><dd className="tabular-nums">{money(d.countedCents ?? 0)}</dd></div>
              <div className="flex justify-between border-t border-stone-100 pt-2"><dt className="font-medium">Over / short</dt><dd><OverShort cents={d.overShortCents ?? 0} currency={currency} /></dd></div>
            </dl>
            {d.closeNote ? <p className="mt-3 whitespace-pre-line rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">{d.closeNote}</p> : null}
            {d.denominations ? (
              <table className="mt-4 w-full text-sm">
                <caption className="mb-1 text-left text-xs font-medium text-stone-500">Counted by bill and coin</caption>
                <tbody>
                  {DENOMINATIONS.filter((x) => d.denominations![String(x.cents)]).map((x) => (
                    <tr key={x.cents} className="border-t border-stone-100">
                      <td className="py-1">{x.label}</td>
                      <td className="py-1 text-right tabular-nums">× {d.denominations![String(x.cents)]}</td>
                      <td className="w-24 py-1 text-right tabular-nums">{money(x.cents * d.denominations![String(x.cents)]!)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </Card>
        )}
      </div>
    </div>
  );
}
