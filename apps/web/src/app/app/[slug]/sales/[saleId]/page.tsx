import Link from "next/link";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmSubmit, Field } from "@/components/form";
import { dateTime } from "@/lib/format";
import { notFound } from "next/navigation";
import { can, cardFeeSettingsOf, isMembershipInterval, periodNoun } from "@angelic/core";
import { cardFeeQuote } from "@/lib/card-fee";
import { requireAnyAction } from "@/lib/tenant";
import { salesScope } from "@/lib/visibility";
import { getSale, isOwnSale, refundableLines } from "@/server/sales";
import { savedCardsForClient } from "@/server/card-on-file";
import { helcimTokenOf } from "@/server/helcim/account";
import { listHelcimDevices } from "@/server/helcim/payments";
import { listLocations, paymentContextForSale, validAtLocation } from "@/server/locations";
import { MapPin, X } from "lucide-react";
import { formatMoney, shiftISODate } from "@/lib/utils";
import { paymentMethodLabel } from "@/lib/payment-methods";
import { Button, Card, Input, PageHeader, Select, MoneyInput } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; saleId: string }> }): Promise<Metadata> {
  const { slug, saleId } = await params;
  const { business, permissions, staffId, user } = await requireAnyAction(slug, "checkout.take", "sales.view.own", "sales.view.all");
  if (salesScope(permissions) === "own" && !(await isOwnSale(business.id, saleId, { staffId, userId: user.id }))) return { title: "Sale" };
  const d = await getSale(business.id, saleId);
  return { title: d ? `Sale #${d.sale.number}` : "Sale" };
}
import { addOffer, addProduct, addProductByCode, putBackOnShelf, addServiceToSale, applyDiscount, applyPromo, applyTips, attachClient, addLateTip, completeSale, deleteLine, editLine, payManual, saveSaleNote, sendReceipt, toggleTaxExempt, payWithGiftCard, payWithPoints, payWithSavedCard, payWithStoreCreditAction, refund, changeRefundReason, removePromo, setFulfillment, useCredit, voidOpenSale } from "./actions";
import { ClientPicker } from "@/components/client-picker";
import { Disclosure } from "@/components/disclosure";
import { ActivityTrail } from "@/components/activity-trail";
import { saleActivity } from "@/server/activity";
import { quickCreateClient } from "../../clients/actions";
import { getClientCredits, getOffersCatalog } from "@/server/offers";
import { serviceGroups } from "@/server/service-groups";
import { ServicePicker } from "@/components/service-picker";
import { schema, withTenant } from "@angelic/db";
import { asc, eq } from "drizzle-orm";
import { instantToISODate } from "@angelic/core";
import { DiscountForm, LateTipForm, RefundForm, RefundReasonEditor, SaleNoteForm, SendReceiptForm, TipsForm } from "./forms";
import { AddToTicket, TakePayment } from "./add-and-pay";
import { ClientTipScreen } from "./client-tip";
import { LineRow } from "./line-row";
import { pointsBalance } from "@/server/loyalty";
import { storeCreditBalance } from "@/server/store-credit";
import { listRefundReasons } from "@/server/refund-reasons";
import { saleStockLocation, saleStockState, stockLevels } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";

export default async function SalePage({ params }: { params: Promise<{ slug: string; saleId: string }> }) {
  const { slug, saleId } = await params;
  // A ticket they may see (M1): any with sales.view.all, else one they are credited on. Working on it also needs checkout.take.
  const { business, permissions, staffId: myStaffId, user } = await requireAnyAction(slug, "checkout.take", "sales.view.own", "sales.view.all");
  const ownOnly = salesScope(permissions) === "own";
  if (ownOnly && !(await isOwnSale(business.id, saleId, { staffId: myStaffId, userId: user.id }))) notFound();
  const data = await getSale(business.id, saleId);
  if (!data) notFound();
  const canDiscount = can(permissions, "checkout.discount");
  const canAdjustTips = can(permissions, "checkout.tips.adjust"); // tips on a paid ticket (M5)
  const { sale, lines, payments, refunds, credits: creditLedger, client, staff, products } = data;
  const cur = business.currency;
  const money = (c: number) => formatMoney(c, cur);
  const due = sale.totalCents - sale.paidCents;
  const open = sale.status === "open";
  const pay = await paymentContextForSale(business, sale.id);
  const multiLocation = (await listLocations(business.id)).length > 1;
  const stripeReady = pay.ready;
  const helcimToken = pay.provider === "helcim" ? helcimTokenOf(business) : null;
  const savedCards = await savedCardsForClient(business, pay, client?.id);
  const helcimDevices = helcimToken && open ? (await listHelcimDevices(business.id, pay.location?.id)).map((x) => ({ id: x.id, name: x.name })) : [];
  const staffOnTicket = [...new Set(lines.filter((l) => l.kind === "service").map((l) => l.staffId).filter((x): x is string => !!x))]
    .map((id) => staff.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ id: s.id, name: s.displayName }));
  // Who a tip can go to: whoever is credited on the ticket (services first, else the products they sold).
  const creditedIds = [...new Set(lines.filter((l) => l.kind === "service" && l.staffId).map((l) => l.staffId!))];
  const creditedAny = creditedIds.length ? creditedIds : [...new Set(lines.filter((l) => l.kind === "product" && l.staffId).map((l) => l.staffId!))];
  const tipStaff = creditedAny.map((id) => staff.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ id: x.id, name: x.displayName }));
  const currentTips: Record<string, number> = {};
  const currentTipMethods: Record<string, "cash" | "card" | ""> = {};
  for (const l of lines.filter((x) => x.kind === "tip" && x.staffId)) {
    currentTips[l.staffId!] = (currentTips[l.staffId!] ?? 0) + l.amountCents;
    const m = l.tipMethod === "cash" || l.tipMethod === "card" ? l.tipMethod : "";
    // Several tip lines for one person (a cash and a card tip) show as "same as the payment" when they differ; saving merges them.
    currentTipMethods[l.staffId!] = l.staffId! in currentTipMethods && currentTipMethods[l.staffId!] !== m ? "" : m;
  }
  // The card fee is its own line under the totals, never edited or removed by hand (it belongs to the payment that carried it).
  const goods = lines.filter((l) => l.kind !== "tip" && l.kind !== "card_fee");
  const cardFeeLines = lines.filter((l) => l.kind === "card_fee");
  const catalog = open ? await getOffersCatalog(business.id) : null;
  const credits = open && client ? await withTenant(business.id, (tx) => getClientCredits(tx, client.id)) : { packages: [], memberships: [] };
  const points = open && client && business.loyaltyEnabled ? await withTenant(business.id, (tx) => pointsBalance(tx, client.id)) : 0;
  const storeCredit = open && client ? await withTenant(business.id, (tx) => storeCreditBalance(tx, client.id)) : 0;
  const canRefund = can(permissions, "checkout.refund");
  // Stock at this sale's location, for the "only N in stock" notes on an open ticket; what was taken off and what has come back, for a closed one.
  const trackedIds = new Set(products.filter((p) => p.trackStock).map((p) => p.id));
  const stockHere = open && trackedIds.size ? await withTenant(business.id, async (tx) => stockLevels(tx, await saleStockLocation(tx, sale), [...trackedIds])) : new Map<string, number>();
  const wantedQty = new Map<string, number>();
  for (const l of lines) if (l.kind === "product" && l.productId) wantedQty.set(l.productId, (wantedQty.get(l.productId) ?? 0) + l.quantity);
  const canStock = can(permissions, "inventory.manage");
  const stockState = !open && (canStock || canRefund) && lines.some((l) => l.kind === "product") ? await saleStockState(business.id, sale.id) : new Map<string, { sold: number; returned: number }>();
  // Active reasons for new refunds; every reason (retired too) so old refunds still show their name.
  const allReasons = canRefund ? await listRefundReasons(business.id, { includeRetired: true }) : [];
  const reasonOptions = allReasons.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name }));
  // Each line with what is left to refund on it, for "what's being refunded".
  const refundLines = canRefund && !open ? (await refundableLines(business.id, sale.id)).filter((l) => l.remainingCents > 0).map((l) => ({ id: l.id, name: l.name, kind: l.kind, productId: l.productId, quantity: l.quantity, remainingCents: l.remainingCents })) : [];
  const reasonName = (id: string | null) => (id ? allReasons.find((r) => r.id === id)?.name ?? null : null);
  const reasonText = (id: string | null, note: string | null) => [reasonName(id), note].filter(Boolean).join(" · ");
  // Credit already given against a payment counts as refunded for what is left to refund.
  const creditedFor = (paymentId: string) => creditLedger.filter((c) => c.paymentId === paymentId && c.reason === "refund").reduce((s, c) => s + c.deltaCents, 0);
  const rebookLine = lines.find((l) => l.kind === "service") ?? null;
  const serviceGroupsForSale = open ? await serviceGroups(business, { meta: "price" }) : [];
  const activity = await saleActivity(business, sale.id);
  const promo = sale.promoCodeId ? await withTenant(business.id, (tx) => tx.query.promoCodes.findFirst({ where: eq(schema.promoCodes.id, sale.promoCodeId!), columns: { code: true } })) : null;
  const typedDiscount: { type: "amount" | "percent"; value: number } | null =
    !sale.promoCodeId && (sale.discountType === "percent" || sale.discountType === "amount") && sale.discountValue ? { type: sale.discountType, value: sale.discountValue } : null;
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });

  return (
    <>
      <PageHeader title={`Sale #${sale.number}`}>
        {multiLocation && pay.location ? <span className="inline-flex items-center gap-1 rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-700"><MapPin className="h-3.5 w-3.5" /> {pay.location.name}</span> : null}
        {sale.appointmentId ? <Link href={`/app/${slug}/appointments/${sale.appointmentId}`} className="text-sm text-brand-700 underline">Appointment</Link> : null}
        {client && rebookLine && can(permissions, "appointments.write.any") ? (
          <Link href={`/app/${slug}/appointments/new?clientId=${client.id}${rebookLine.serviceId ? `&serviceId=${rebookLine.serviceId}` : ""}${rebookLine.staffId ? `&staffId=${rebookLine.staffId}` : ""}&date=${shiftISODate(instantToISODate(sale.closedAt ?? new Date(), business.timezone), 28)}${multiLocation && pay.location ? `&location=${pay.location.id}` : ""}`} className="text-sm text-brand-700 underline" title="Book the next visit: same service and provider, four weeks out">Rebook</Link>
        ) : null}
        <Link href={`/app/${slug}/sales/${sale.id}/receipt`} className="text-sm text-brand-700 underline">Receipt</Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="min-w-0 space-y-6">
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="font-medium">{client ? `${client.firstName} ${client.lastName}`.trim() : "Walk-in"}</p>
                <p className="flex items-center gap-2 text-xs text-stone-500">{dateTime(sale.createdAt, business.timezone)} <StatusBadge status={sale.status} /></p>
              </div>
              {open && sale.paidCents === 0 && canDiscount ? (
                <form action={voidOpenSale}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="saleId" value={sale.id} />
                  <ConfirmSubmit title="Void this sale?" body="The ticket is closed with nothing charged. The appointment stays as it is." confirmLabel="Void sale" variant="ghost">Void</ConfirmSubmit>
                </form>
              ) : null}
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                {goods.map((l) => (
                  <LineRow
                    key={l.id}
                    editor={open && l.kind !== "tip" && l.creditCents === 0 ? (
                      <form action={editLine} className="flex flex-wrap items-end gap-2 rounded-lg bg-stone-50 p-3">
                        <input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="lineId" value={l.id} />
                        {canDiscount ? <Field label="Unit price" className="w-32"><MoneyInput name="price" defaultValue={(l.unitCents / 100).toFixed(2)} /></Field> : null}
                        {l.kind === "product" ? <Field label="Quantity" className="w-24"><Input name="quantity" type="number" min={1} max={99} defaultValue={l.quantity} /></Field> : null}
                        {ownOnly ? null : (
                          <Field label="Staff credit" className="w-48">
                            <Select name="staffId" defaultValue={l.staffId ?? ""}>
                              <option value="">No staff credit</option>
                              {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                            </Select>
                          </Field>
                        )}
                        <Button type="submit" size="sm" variant="secondary" className="h-10">Save</Button>
                      </form>
                    ) : undefined}
                    remove={open ? (
                      <form action={deleteLine}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="saleId" value={sale.id} />
                        <input type="hidden" name="lineId" value={l.id} />
                        <button className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600" aria-label="Remove line" title="Remove"><X className="h-3.5 w-3.5" aria-hidden /></button>
                      </form>
                    ) : undefined}
                  >
                    <td className="py-2">
                      <p>{l.name}{l.quantity > 1 ? ` × ${l.quantity}` : ""}{l.memberDiscountBps ? <span className="ml-1 text-xs text-emerald-700">member {l.memberDiscountBps / 100}% off</span> : null}</p>
                      <p className="text-xs text-stone-500">{[l.kind, staff.find((s) => s.id === l.staffId)?.displayName, l.taxable ? "taxable" : null].filter(Boolean).join(" · ")}</p>
                      {open && l.kind === "product" && l.productId && trackedIds.has(l.productId) && (stockHere.get(l.productId) ?? 0) < (wantedQty.get(l.productId) ?? 0) ? (
                        <p className="text-xs text-amber-700">{Math.max(0, stockHere.get(l.productId) ?? 0) === 0 ? "None in stock" : `Only ${stockHere.get(l.productId)} in stock`}{multiLocation ? " here" : ""}. You can still sell it; the count may be off.</p>
                      ) : null}
                    </td>
                    <td className="py-2 text-right">
                      {money(l.amountCents)}
                      {open && l.kind === "service" && l.amountCents > 0 ? (
                        <div className="mt-1 flex flex-wrap justify-end gap-1">
                          {credits.packages.filter((p) => (!p.serviceId || p.serviceId === l.serviceId) && validAtLocation(p.validLocationIds, sale.locationId)).map((p) => (
                            <form key={p.id} action={useCredit}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="lineId" value={l.id} /><input type="hidden" name="source" value="package" /><input type="hidden" name="sourceId" value={p.id} /><button className="rounded border border-brand-300 bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-800">Use package ({p.remaining} left)</button></form>
                          ))}
                          {credits.memberships.filter((m) => m.creditsRemaining > 0 && (!m.includedServiceId || m.includedServiceId === l.serviceId) && validAtLocation(m.validLocationIds, sale.locationId)).map((m) => (
                            <form key={m.id} action={useCredit}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="lineId" value={l.id} /><input type="hidden" name="source" value="membership" /><input type="hidden" name="sourceId" value={m.id} /><button className="rounded border border-brand-300 bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-800">Use {m.planName} credit ({m.creditsRemaining} left)</button></form>
                          ))}
                        </div>
                      ) : null}
                    </td>
                  </LineRow>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr><td className="pt-3 text-stone-500">Subtotal</td><td className="pt-3 text-right">{money(sale.subtotalCents)}</td><td /></tr>
                {sale.discountCents > 0 ? <tr><td className="text-stone-500">Discount{sale.discountNote ? ` (${sale.discountNote})` : ""}</td><td className="text-right">−{money(sale.discountCents)}</td><td /></tr> : null}
                {sale.taxCents > 0 ? <tr><td className="text-stone-500">Tax ({(pay.taxRateBps / 100).toFixed(2)}%)</td><td className="text-right">{money(sale.taxCents)}</td><td /></tr> : null}
                {sale.taxExempt ? <tr><td className="text-stone-500">Tax exempt</td><td className="text-right text-stone-500">no tax charged</td><td /></tr> : null}
                {sale.tipCents > 0 ? <tr><td className="text-stone-500">Tips</td><td className="text-right">{money(sale.tipCents)}</td><td /></tr> : null}
                {cardFeeLines.map((l) => <tr key={l.id}><td className="text-stone-500">{l.name}</td><td className="text-right">{money(l.amountCents)}</td><td /></tr>)}
                <tr className="text-base font-semibold"><td className="pt-2">Total</td><td className="pt-2 text-right">{money(sale.totalCents)}</td><td /></tr>
                {sale.paidCents > 0 ? <tr><td className="text-stone-500">Paid</td><td className="text-right">{money(sale.paidCents)}</td><td /></tr> : null}
                {sale.refundedCents > 0 ? <tr><td className="text-stone-500">Refunded</td><td className="text-right">−{money(sale.refundedCents)}</td><td /></tr> : null}
                {open ? <tr className="font-semibold text-brand-700"><td>Due</td><td className="text-right">{money(due)}</td><td /></tr> : null}
              </tfoot>
            </table>
            </div>
            {open && (goods.some((l) => l.taxable) || sale.taxExempt) ? (
              <form action={toggleTaxExempt} className="mt-3 border-t border-stone-100 pt-2">
                <input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} />
                <input type="hidden" name="exempt" value={sale.taxExempt ? "0" : "1"} />
                <button type="submit" className="text-xs text-stone-500 underline hover:text-stone-800">{sale.taxExempt ? "Charge sales tax on this ticket" : "Tax exempt: don't charge sales tax on this ticket"}</button>
              </form>
            ) : null}
          </Card>

          {open ? (
            <div className="space-y-3">
              <Disclosure title="Add to this ticket" defaultOpen={goods.length === 0}>
                <AddToTicket
                  slug={slug}
                  saleId={sale.id}
                  staff={staff.map((s) => ({ id: s.id, name: s.displayName }))}
                  products={products.map((p) => ({ id: p.id, label: productLabel(p), category: p.category ?? "Other", priceLabel: money(p.priceCents), stock: p.trackStock ? ((stockHere.get(p.id) ?? 0) <= 0 ? "none in stock" : `${stockHere.get(p.id)} in stock`) : null, out: !!p.trackStock && (stockHere.get(p.id) ?? 0) <= 0, imageUrl: p.imageUrl }))}
                  productsHref={`/app/${slug}/products`}
                  autoFocus={goods.length === 0}
                  groups={serviceGroupsForSale}
                  packages={(catalog?.packages ?? []).filter((p) => p.active).map((p) => ({ id: p.id, label: `${p.name} · ${money(p.priceCents)}` }))}
                  plans={client ? (catalog?.plans ?? []).filter((p) => p.active).map((p) => ({ id: p.id, label: `${p.name} · ${money(p.priceCents)} / ${periodNoun(isMembershipInterval(p.interval) ? p.interval : "month", p.intervalCount)}` })) : []}
                  actions={{ addProduct, addProductByCode, addService: addServiceToSale, addOffer }}
                />
              </Disclosure>
              <Disclosure title="Discount" hint={promo ? `code ${promo.code} applied` : sale.discountCents > 0 ? `${money(sale.discountCents)} off` : undefined} open={!!promo || sale.discountCents > 0}>
                <DiscountForm key={`${sale.discountCents}:${sale.discountNote ?? ""}:${sale.promoCodeId ?? ""}`} action={applyDiscount} promoAction={applyPromo} removePromoAction={removePromo} slug={slug} saleId={sale.id} canDiscount={canDiscount} current={typedDiscount} note={sale.promoCodeId ? null : sale.discountNote} promo={promo?.code ?? null} />
              </Disclosure>
              {goods.length > 0 && (open || canAdjustTips) ? (
                <Card className="p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-medium">Tips</h2>
                    {open && tipStaff.length && sale.subtotalCents - sale.discountCents > 0 ? (
                      <ClientTipScreen
                        slug={slug}
                        saleId={sale.id}
                        action={applyTips}
                        baseCents={Math.max(0, sale.subtotalCents - sale.discountCents)}
                        totalBeforeTipCents={sale.totalCents - sale.tipCents}
                        currency={cur}
                        presets={business.tipPercents}
                        target={tipStaff.length === 1 ? tipStaff[0]!.id : ""}
                        staffNames={tipStaff.map((s) => s.name.split(" ")[0]!)}
                        business={{ name: business.name, logoUrl: business.logoUrl, brandColor: business.brandColor }}
                        clientFirstName={client?.firstName ?? null}
                      />
                    ) : null}
                  </div>
                  <TipsForm percents={business.tipPercents} key={JSON.stringify([currentTips, currentTipMethods])} action={applyTips} slug={slug} saleId={sale.id} staff={tipStaff} current={currentTips} currentMethods={currentTipMethods} baseCents={Math.max(0, sale.subtotalCents - sale.discountCents)} currency={cur} choices={tipStaff.length ? [] : staff.map((x) => ({ id: x.id, name: x.displayName }))} />
                </Card>
              ) : null}
            </div>
          ) : null}

          {payments.length > 0 ? (
            <Card className="p-4">
              <h2 className="mb-2 font-medium">Payments</h2>
              <ul className="divide-y divide-stone-100 text-sm">
                {payments.map((p) => {
                  const credited = creditedFor(p.id);
                  // What the desk can still refund, without the card fee (its share goes back on its own, in proportion).
                  const refundable = p.amountCents - p.refundedCents - credited - Math.max(0, p.surchargeCents - p.surchargeRefundedCents);
                  return (
                    <li key={p.id} className="py-2">
                      <div className="flex items-center justify-between">
                        <span>
                          {paymentMethodLabel(p.method)}{p.cardLast4 ? ` · ${p.cardBrand ? `${p.cardBrand.toUpperCase()} ` : ""}•••• ${p.cardLast4}` : ""}
                          <StatusBadge status={p.status} className="ml-2" />
                          {p.note ? <span className="ml-2 text-xs text-stone-500">{p.note}</span> : null}
                        </span>
                        <span className="font-medium">{money(p.amountCents)}{p.refundedCents || credited ? <span className="text-xs text-stone-500"> (−{money(p.refundedCents + credited)})</span> : null}</span>
                      </div>
                      {refunds.filter((r) => r.paymentId === p.id).map((r) => (
                        <div key={r.id} className="text-xs text-stone-500">
                          Refunded {money(r.amountCents)}{r.surchargeCents ? ` (incl. ${money(r.surchargeCents)} card fee)` : ""}{reasonText(r.reasonId, r.reason) ? ` · ${reasonText(r.reasonId, r.reason)}` : ""}
                          {canRefund ? <RefundReasonEditor key={`${r.reasonId}:${r.reason}`} action={changeRefundReason} slug={slug} saleId={sale.id} kind="refund" id={r.id} reasonId={r.reasonId} note={r.reason} reasons={reasonOptions} /> : null}
                        </div>
                      ))}
                      {creditLedger.filter((c) => c.paymentId === p.id && c.reason === "refund").map((c) => (
                        <div key={c.id} className="text-xs text-stone-500">
                          Refunded {money(c.deltaCents)} as store credit{reasonText(c.refundReasonId, c.note) ? ` · ${reasonText(c.refundReasonId, c.note)}` : ""}
                          {canRefund ? <RefundReasonEditor key={`${c.refundReasonId}:${c.note}`} action={changeRefundReason} slug={slug} saleId={sale.id} kind="credit" id={c.id} reasonId={c.refundReasonId} note={c.note} reasons={reasonOptions} /> : null}
                        </div>
                      ))}
                      {p.status !== "pending" && p.status !== "failed" && refundable > 0 && canRefund ? (
                        <RefundForm key={`${p.id}:${refundable}`} action={refund} slug={slug} saleId={sale.id} paymentId={p.id} maxCents={refundable} creditAllowed={!!client && p.method !== "store_credit"} external={p.method === "external_card"} cardFee={p.surchargeCents > p.surchargeRefundedCents} reasons={reasonOptions} items={refundLines} goods={[...stockState.entries()].filter(([, v]) => v.sold - v.returned > 0).map(([productId, v]) => ({ productId, name: lines.find((l) => l.productId === productId)?.name ?? "Product", left: v.sold - v.returned }))} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
          <ActivityTrail summary={activity.summary} events={activity.events} timeZone={business.timezone} mode="sale" />
        </div>

        <div className="min-w-0 space-y-6">
          {open ? (
            <>
              <Card className="p-4">
                <h2 className="mb-1 font-medium">Take payment</h2>
                <p className="mb-3 text-2xl font-semibold">{money(due)} <span className="text-sm font-normal text-stone-500">due</span></p>
                {due <= 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-stone-500">Nothing due.</p>
                    {goods.length > 0 ? (
                      <form action={completeSale}>
                        <input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} />
                        <Button type="submit" size="sm">Complete sale</Button>
                      </form>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <TakePayment
                      slug={slug}
                      saleId={sale.id}
                      dueCents={due}
                      currency={cur}
                      cardFee={(() => {
                        const q = cardFeeQuote(cardFeeSettingsOf(business), pay.provider, "desk", due, business.currency, { cashOption: true });
                        return q ? { notice: q.notice, cardTotal: money(due + q.estimateCents) } : null;
                      })()}
                      hasClient={!!client}
                      savedCards={savedCards.map((c) => ({ id: c.id, brand: c.brand, last4: c.last4, expMonth: c.expMonth, expYear: c.expYear }))}
                      helcim={helcimToken ? { devices: helcimDevices } : null}
                      stripe={stripeReady ? { publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null, test: (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_test") } : null}
                      storeCredit={client ? storeCredit : 0}
                      points={business.loyaltyEnabled && client && points >= business.loyaltyMinRedeemPoints ? { balance: points, pointValueCents: business.loyaltyPointValueCents, minPoints: business.loyaltyMinRedeemPoints } : null}
                      actions={{ payManual, payWithGiftCard, payWithSavedCard, payWithStoreCredit: payWithStoreCreditAction, payWithPoints }}
                    />
                    {!stripeReady && !helcimToken && can(permissions, "billing.manage") ? (
                      <p className="text-xs text-stone-500">To take cards, connect Stripe under <Link className="underline" href={`/app/${slug}/settings/payments`}>Settings → Payments</Link>.</p>
                    ) : null}
                  </div>
                )}
                <div className="mt-4 border-t border-stone-200 pt-3 text-sm">
                  <Link href={`/app/${slug}/sales?tab=open`} className="text-brand-700 underline">Save for later</Link>
                  <span className="text-stone-500"> · the ticket stays open under Sales → Open, and the amount due shows on the client&apos;s history.</span>
                </div>
              </Card>
            </>
          ) : (
            <Card className="p-4">
              <h2 className="font-medium">{sale.status === "paid" ? "Paid in full" : sale.status === "refunded" ? "Refunded" : "Void"}</h2>
              {sale.closedAt ? <p className="text-sm text-stone-500">{fmt.format(sale.closedAt)}</p> : null}
            </Card>
          )}
          {sale.status === "paid" && goods.length > 0 && canAdjustTips ? (
            <Disclosure title="Add a tip" hint="after the sale was paid">
              <p className="mb-2 text-xs text-stone-500">Added to the sale and the stylist&apos;s pay.{savedCards.length === 0 ? " To charge it to a card, attach a client who has a card on file." : ""}</p>
              <LateTipForm action={addLateTip} slug={slug} saleId={sale.id} staff={tipStaff.length ? tipStaff : staff.map((x) => ({ id: x.id, name: x.displayName }))} cards={savedCards.map((c) => ({ id: c.id, brand: c.brand, last4: c.last4 }))} />
            </Disclosure>
          ) : null}
          {!open && sale.status !== "void" ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-2 font-medium">Send receipt</h2>
              <SendReceiptForm action={sendReceipt} slug={slug} saleId={sale.id} email={client?.email ?? null} phone={client?.phone ?? null} />
            </Card>
          ) : null}
          {open || sale.notes ? (
            <Disclosure title="Note" hint={sale.notes ? undefined : "private, not on the receipt"} open={!!sale.notes}>
              <SaleNoteForm action={saveSaleNote} slug={slug} saleId={sale.id} notes={sale.notes} />
            </Disclosure>
          ) : null}
          {canStock && [...stockState.entries()].some(([, v]) => v.sold > 0) ? (
            <Disclosure title="Goods back on the shelf">
              <p className="mb-2 text-xs text-stone-500">A refund gives money back; it doesn't change the stock, because the product may be gone (never arrived, goodwill). If a client really brought something back, put it back here.</p>
              <form action={putBackOnShelf} className="space-y-2">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="saleId" value={sale.id} />
                {[...stockState.entries()].filter(([, v]) => v.sold > 0).map(([productId, v]) => {
                  const line = lines.find((l) => l.productId === productId);
                  const left = v.sold - v.returned;
                  return (
                    <div key={productId} className="grid grid-cols-[1fr_4rem] items-center gap-2">
                      <label htmlFor={`back:${productId}`} className="min-w-0 truncate">{line?.name ?? "Product"} <span className="text-xs text-stone-500">· sold {v.sold}{v.returned ? ` · ${v.returned} already back` : ""}</span></label>
                      {left > 0 ? <Input id={`back:${productId}`} name={`back:${productId}`} type="number" min={0} max={left} placeholder="0" className="text-right" /> : <span className="text-right text-xs text-stone-500">all back</span>}
                    </div>
                  );
                })}
                <Input name="note" placeholder="Why (optional), e.g. unopened, returned" aria-label="Note" />
                <Button type="submit" size="sm" variant="secondary">Put back on the shelf</Button>
              </form>
            </Disclosure>
          ) : null}
          {sale.fulfillment ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-medium">Online order · {sale.fulfillment.method === "ship" ? "shipping" : "pickup"}</h2>
              {sale.fulfillment.address ? <p className="whitespace-pre-line text-stone-600">{sale.fulfillment.address}</p> : null}
              {sale.fulfillment.message ? <p className="mt-1 italic text-stone-600">“{sale.fulfillment.message}”</p> : null}
              <p className="mt-1">Status: <b>{sale.fulfillment.status ?? "pending"}</b></p>
              {sale.status === "paid" ? (
                <form action={setFulfillment} className="mt-2 flex gap-1">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="saleId" value={sale.id} />
                  {(["pending", "ready", "done"] as const).filter((s) => s !== (sale.fulfillment?.status ?? "pending")).map((s) => <Button key={s} name="status" value={s} size="sm" variant="secondary" type="submit">{s === "ready" ? (sale.fulfillment?.method === "ship" ? "Mark shipped" : "Mark ready") : s === "done" ? "Mark collected" : "Back to pending"}</Button>)}
                </form>
              ) : null}
            </Card>
          ) : null}
          {client ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-medium">Client</h2>
              <p><Link href={`/app/${slug}/clients/${client.id}`} className="hover:underline">{client.firstName} {client.lastName}</Link></p>
              {client.phone ? <p className="text-stone-600">{client.phone}</p> : null}
              {client.email ? <p className="text-stone-600">{client.email}</p> : null}
              {savedCards.length ? <p className="mt-2 text-xs text-stone-500">{savedCards.length} saved card{savedCards.length > 1 ? "s" : ""}</p> : null}
              {open && !sale.appointmentId ? (
                <form action={attachClient} className="mt-2">
                  <input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="clientId" value="" />
                  <Button type="submit" size="sm" variant="ghost">Detach client</Button>
                </form>
              ) : null}
            </Card>
          ) : open ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-medium">Client</h2>
              <p className="mb-2 text-xs text-stone-500">Walk-in. Attach a client for loyalty points, saved cards, memberships and an emailed receipt.</p>
              <form action={attachClient} className="space-y-2">
                <input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} />
                <ClientPicker slug={slug} initial={null} canCreate={can(permissions, "clients.write")} createClient={quickCreateClient} allowWalkIn={false} />
                <Button type="submit" size="sm" variant="secondary">Attach</Button>
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
