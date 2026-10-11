import Link from "next/link";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmSubmit } from "@/components/form";
import { dateTime } from "@/lib/format";
import { notFound } from "next/navigation";
import { can, isMembershipInterval, periodNoun } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { getSale } from "@/server/sales";
import { savedCardsFor } from "@/server/stripe-connect";
import { listLocations, paymentContextForSale, validAtLocation } from "@/server/locations";
import { MapPin } from "lucide-react";
import { formatMoney, shiftISODate } from "@/lib/utils";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; saleId: string }> }): Promise<Metadata> {
  const { slug, saleId } = await params;
  const { business } = await requireAction(slug, "checkout.take");
  const d = await getSale(business.id, saleId);
  return { title: d ? `Sale #${d.sale.number}` : "Sale" };
}
import { addOffer, addProduct, addServiceToSale, applyDiscount, applyPromo, applyTips, attachClient, deleteLine, editLine, emailReceipt, payManual, payWithGiftCard, payWithPoints, payWithSavedCard, payWithStoreCreditAction, refund, changeRefundReason, removePromo, setFulfillment, useCredit, voidOpenSale } from "./actions";
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
import { DiscountForm, GiftCardPayForm, ManualPayForm, PointsPayForm, PromoForm, RefundForm, RefundReasonEditor, SavedCardForm, StoreCreditPayForm, TipsForm } from "./forms";
import { pointsBalance } from "@/server/loyalty";
import { storeCreditBalance } from "@/server/store-credit";
import { listRefundReasons } from "@/server/refund-reasons";
import { CardPayment } from "./card-payment";

export default async function SalePage({ params }: { params: Promise<{ slug: string; saleId: string }> }) {
  const { slug, saleId } = await params;
  const { business, permissions } = await requireAction(slug, "checkout.take");
  const data = await getSale(business.id, saleId);
  if (!data) notFound();
  const { sale, lines, payments, refunds, credits: creditLedger, client, staff, products } = data;
  const cur = business.currency;
  const money = (c: number) => formatMoney(c, cur);
  const due = sale.totalCents - sale.paidCents;
  const open = sale.status === "open";
  const pay = await paymentContextForSale(business, sale.id);
  const multiLocation = (await listLocations(business.id)).length > 1;
  const stripeReady = pay.ready;
  const savedCards = await savedCardsFor(business.id, pay, client?.id);
  const staffOnTicket = [...new Set(lines.filter((l) => l.kind === "service").map((l) => l.staffId).filter((x): x is string => !!x))]
    .map((id) => staff.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ id: s.id, name: s.displayName }));
  const currentTips = Object.fromEntries(lines.filter((l) => l.kind === "tip" && l.staffId).map((l) => [l.staffId!, l.amountCents]));
  const goods = lines.filter((l) => l.kind !== "tip");
  const catalog = open ? await getOffersCatalog(business.id) : null;
  const credits = open && client ? await withTenant(business.id, (tx) => getClientCredits(tx, client.id)) : { packages: [], memberships: [] };
  const points = open && client && business.loyaltyEnabled ? await withTenant(business.id, (tx) => pointsBalance(tx, client.id)) : 0;
  const storeCredit = open && client ? await withTenant(business.id, (tx) => storeCreditBalance(tx, client.id)) : 0;
  const canRefund = can(permissions, "reports.view");
  // Active reasons for new refunds; every reason (retired too) so old refunds still show their name.
  const allReasons = canRefund ? await listRefundReasons(business.id, { includeRetired: true }) : [];
  const reasonOptions = allReasons.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name }));
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
        {!open && client?.email ? (
          <form action={emailReceipt}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="saleId" value={sale.id} />
            <Button type="submit" size="sm" variant="secondary">Email receipt</Button>
          </form>
        ) : null}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="font-medium">{client ? `${client.firstName} ${client.lastName}`.trim() : "Walk-in"}</p>
                <p className="flex items-center gap-2 text-xs text-stone-500">{dateTime(sale.createdAt, business.timezone)} <StatusBadge status={sale.status} /></p>
              </div>
              {open && sale.paidCents === 0 ? (
                <form action={voidOpenSale}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="saleId" value={sale.id} />
                  <ConfirmSubmit title="Void this sale?" body="The ticket is closed with nothing charged. The appointment stays as it is." confirmLabel="Void sale" variant="ghost">Void</ConfirmSubmit>
                </form>
              ) : null}
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                {goods.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2">
                      <p>{l.name}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</p>
                      <p className="text-xs text-stone-500">{[l.kind, staff.find((s) => s.id === l.staffId)?.displayName, l.taxable ? "taxable" : null].filter(Boolean).join(" · ")}</p>
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
                    <td className="w-10 py-2 text-right">
                      {open && l.kind !== "tip" && l.creditCents === 0 ? (
                        <details className="mb-1 text-left">
                          <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-800">Edit</summary>
                          <form action={editLine} className="mt-1 flex w-56 flex-col gap-1">
                            <input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="lineId" value={l.id} />
                            <Input name="price" inputMode="decimal" defaultValue={(l.unitCents / 100).toFixed(2)} aria-label="Unit price" />
                            {l.kind === "product" ? <Input name="quantity" type="number" min={1} max={99} defaultValue={l.quantity} aria-label="Quantity" /> : null}
                            <Select name="staffId" defaultValue={l.staffId ?? ""} aria-label="Staff credit">
                              <option value="">No staff credit</option>
                              {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                            </Select>
                            <Button type="submit" size="sm" variant="secondary">Save</Button>
                          </form>
                        </details>
                      ) : null}
                      {open ? (
                        <form action={deleteLine}>
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="saleId" value={sale.id} />
                          <input type="hidden" name="lineId" value={l.id} />
                          <button className="text-xs text-stone-400 hover:text-red-600" aria-label="Remove line">✕</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr><td className="pt-3 text-stone-500">Subtotal</td><td className="pt-3 text-right">{money(sale.subtotalCents)}</td><td /></tr>
                {sale.discountCents > 0 ? <tr><td className="text-stone-500">Discount{sale.discountNote ? ` (${sale.discountNote})` : ""}</td><td className="text-right">−{money(sale.discountCents)}</td><td /></tr> : null}
                {sale.taxCents > 0 ? <tr><td className="text-stone-500">Tax ({(pay.taxRateBps / 100).toFixed(2)}%)</td><td className="text-right">{money(sale.taxCents)}</td><td /></tr> : null}
                {sale.tipCents > 0 ? <tr><td className="text-stone-500">Tips</td><td className="text-right">{money(sale.tipCents)}</td><td /></tr> : null}
                <tr className="text-base font-semibold"><td className="pt-2">Total</td><td className="pt-2 text-right">{money(sale.totalCents)}</td><td /></tr>
                {sale.paidCents > 0 ? <tr><td className="text-stone-500">Paid</td><td className="text-right">{money(sale.paidCents)}</td><td /></tr> : null}
                {sale.refundedCents > 0 ? <tr><td className="text-stone-500">Refunded</td><td className="text-right">−{money(sale.refundedCents)}</td><td /></tr> : null}
                {open ? <tr className="font-semibold text-brand-700"><td>Due</td><td className="text-right">{money(due)}</td><td /></tr> : null}
              </tfoot>
            </table>
          </Card>

          {open ? (
            <div className="space-y-3">
              <Disclosure title="Add to this ticket" hint="product, retail or an extra service">
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-stone-700">Product</h3>
                    {products.length === 0 ? (
                      <p className="text-sm text-stone-500">No products yet. Add some under <Link className="underline" href={`/app/${slug}/products`}>Products</Link>.</p>
                    ) : (
                      <form action={addProduct} className="space-y-2">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="saleId" value={sale.id} />
                        <Select name="productId">
                          {[...new Set(products.map((p) => p.category ?? "Other"))].map((cat) => (
                            <optgroup key={cat} label={cat}>
                              {products.filter((p) => (p.category ?? "Other") === cat).map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.priceCents)}</option>)}
                            </optgroup>
                          ))}
                        </Select>
                        <div className="grid grid-cols-[5rem_1fr] gap-2">
                          <input name="quantity" type="number" min={1} max={99} defaultValue={1} className="h-10 rounded-lg border border-stone-300 px-3 text-sm" aria-label="Quantity" />
                          <Select name="staffId" defaultValue={staffOnTicket[0]?.id ?? ""}>
                            <option value="">No staff credit</option>
                            {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                          </Select>
                        </div>
                        <Button type="submit" size="sm" variant="secondary">Add product</Button>
                      </form>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-stone-700">Service</h3>
                    <form action={addServiceToSale} className="space-y-2">
                      <input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} />
                      <ServicePicker name="serviceId" groups={serviceGroupsForSale} value={null} />
                      <div className="grid grid-cols-2 gap-2">
                        <Select name="staffId" defaultValue={staffOnTicket[0]?.id ?? ""}>
                          <option value="">No staff credit</option>
                          {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                        </Select>
                        <Input name="price" inputMode="decimal" placeholder="Price (optional)" />
                      </div>
                      <Button type="submit" size="sm" variant="secondary">Add service</Button>
                    </form>
                  </div>
                </div>
              </Disclosure>
              <Disclosure title="Discount or promo code" hint={promo ? `code ${promo.code} applied` : sale.discountCents > 0 ? `${money(sale.discountCents)} off` : undefined} open={!!promo || sale.discountCents > 0}>
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-stone-700">Discount</h3>
                    <DiscountForm key={`${sale.discountCents}:${sale.discountNote ?? ""}:${sale.promoCodeId ?? ""}`} action={applyDiscount} slug={slug} saleId={sale.id} currentCents={sale.promoCodeId ? 0 : sale.discountCents} current={typedDiscount} note={sale.promoCodeId ? null : sale.discountNote} />
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-stone-700">Promo code</h3>
                    <PromoForm key={`promo${sale.promoCodeId ?? ""}`} action={applyPromo} slug={slug} saleId={sale.id} applied={promo?.code ?? null} removeAction={removePromo} />
                  </div>
                </div>
              </Disclosure>
              <Disclosure title="Sell a gift card, package or membership">
                <div className="grid gap-4 md:grid-cols-3">
                  <form action={addOffer} className="space-y-2">
                    <input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="kind" value="gift_card" />
                    <Input name="amount" inputMode="decimal" placeholder="Gift card amount" required />
                    <Input name="recipientName" placeholder="Recipient (optional)" />
                    <Button type="submit" size="sm" variant="secondary">Add gift card</Button>
                  </form>
                  <form action={addOffer} className="space-y-2">
                    <input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="kind" value="package" />
                    <Select name="refId" required>{(catalog?.packages ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.priceCents)}</option>)}</Select>
                    <Button type="submit" size="sm" variant="secondary" disabled={!catalog?.packages.some((p) => p.active)}>Add package</Button>
                  </form>
                  <form action={addOffer} className="space-y-2">
                    <input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="kind" value="membership" />
                    <Select name="refId" required>{(catalog?.plans ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.priceCents)} / {periodNoun(isMembershipInterval(p.interval) ? p.interval : "month", p.intervalCount)}</option>)}</Select>
                    <Button type="submit" size="sm" variant="secondary" disabled={!client || !catalog?.plans.some((p) => p.active)}>Add membership{!client ? " (needs client)" : ""}</Button>
                  </form>
                </div>
              </Disclosure>
              {staffOnTicket.length > 0 ? (
                <Card className="p-4">
                  <h2 className="mb-2 font-medium">Tips</h2>
                  <TipsForm key={JSON.stringify(currentTips)} action={applyTips} slug={slug} saleId={sale.id} staff={staffOnTicket} current={currentTips} />
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
                  const refundable = p.amountCents - p.refundedCents - credited;
                  return (
                    <li key={p.id} className="py-2">
                      <div className="flex items-center justify-between">
                        <span>
                          {p.method.replace("_", " ")}{p.cardBrand ? ` · ${p.cardBrand.toUpperCase()} •••• ${p.cardLast4}` : ""}
                          <StatusBadge status={p.status} className="ml-2" />
                          {p.note ? <span className="ml-2 text-xs text-stone-500">{p.note}</span> : null}
                        </span>
                        <span className="font-medium">{money(p.amountCents)}{p.refundedCents || credited ? <span className="text-xs text-stone-500"> (−{money(p.refundedCents + credited)})</span> : null}</span>
                      </div>
                      {refunds.filter((r) => r.paymentId === p.id).map((r) => (
                        <div key={r.id} className="text-xs text-stone-500">
                          Refunded {money(r.amountCents)}{reasonText(r.reasonId, r.reason) ? ` · ${reasonText(r.reasonId, r.reason)}` : ""}
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
                        <RefundForm key={`${p.id}:${refundable}`} action={refund} slug={slug} saleId={sale.id} paymentId={p.id} maxCents={refundable} creditAllowed={!!client && p.method !== "store_credit"} reasons={reasonOptions} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
          <ActivityTrail summary={activity.summary} events={activity.events} timeZone={business.timezone} mode="sale" />
        </div>

        <div className="space-y-6">
          {open ? (
            <>
              <Card className="p-4">
                <h2 className="mb-1 font-medium">Take payment</h2>
                <p className="mb-3 text-2xl font-semibold">{money(due)} <span className="text-sm font-normal text-stone-500">due</span></p>
                {due <= 0 ? <p className="text-sm text-stone-500">Nothing due.</p> : (
                  <div className="space-y-5">
                    <div>
                      <h3 className="mb-1 text-sm font-medium text-stone-700">Cash / other</h3>
                      <ManualPayForm key={due} action={payManual} slug={slug} saleId={sale.id} dueCents={due} />
                    </div>
                    <div className="border-t border-stone-200 pt-4">
                      <h3 className="mb-1 text-sm font-medium text-stone-700">Gift card</h3>
                      <GiftCardPayForm key={`gc${due}`} action={payWithGiftCard} slug={slug} saleId={sale.id} dueCents={due} />
                    </div>
                    {client && storeCredit > 0 ? (
                      <div className="border-t border-stone-200 pt-4">
                        <h3 className="mb-1 text-sm font-medium text-stone-700">Store credit</h3>
                        <StoreCreditPayForm key={`sc${due}`} action={payWithStoreCreditAction} slug={slug} saleId={sale.id} balanceCents={storeCredit} dueCents={due} />
                      </div>
                    ) : null}
                    {business.loyaltyEnabled && client && points > 0 ? (
                      <div className="border-t border-stone-200 pt-4">
                        <h3 className="mb-1 text-sm font-medium text-stone-700">Loyalty points</h3>
                        <PointsPayForm key={`pt${due}`} action={payWithPoints} slug={slug} saleId={sale.id} balance={points} pointValueCents={business.loyaltyPointValueCents} dueCents={due} minPoints={business.loyaltyMinRedeemPoints} />
                      </div>
                    ) : null}
                    <div className="border-t border-stone-200 pt-4">
                      <h3 className="mb-1 text-sm font-medium text-stone-700">Card</h3>
                      {!stripeReady ? (
                        <p className="text-sm text-stone-500">
                          {can(permissions, "business.manage") ? <>Connect Stripe under <Link className="underline" href={`/app/${slug}/settings/payments`}>Settings → Payments</Link> to take cards.</> : "Card payments aren't set up yet."}
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {savedCards.length > 0 ? (
                            <SavedCardForm key={due} action={payWithSavedCard} slug={slug} saleId={sale.id} dueCents={due} cards={savedCards} />
                          ) : null}
                          <CardPayment slug={slug} saleId={sale.id} dueCents={due} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null} hasClient={!!client} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            </>
          ) : (
            <Card className="p-4">
              <h2 className="font-medium">{sale.status === "paid" ? "Paid in full" : sale.status === "refunded" ? "Refunded" : "Void"}</h2>
              {sale.closedAt ? <p className="text-sm text-stone-500">{fmt.format(sale.closedAt)}</p> : null}
            </Card>
          )}
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
              <p className="mb-2 text-xs text-stone-500">Walk-in. Attach a client for loyalty points, saved cards and an emailed receipt.</p>
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
