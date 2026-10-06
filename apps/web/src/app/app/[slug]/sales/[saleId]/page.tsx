import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { getSale } from "@/server/sales";
import { listSavedCards } from "@/server/stripe-connect";
import { isStripeConfigured } from "@/lib/stripe";
import { formatMoney } from "@/lib/utils";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { addOffer, addProduct, applyDiscount, applyTips, deleteLine, payManual, payWithGiftCard, payWithSavedCard, refund, useCredit, voidOpenSale } from "./actions";
import { getClientCredits, getOffersCatalog } from "@/server/offers";
import { withTenant } from "@angelic/db";
import { DiscountForm, GiftCardPayForm, ManualPayForm, RefundForm, SavedCardForm, TipsForm } from "./forms";
import { CardPayment } from "./card-payment";

export default async function SalePage({ params }: { params: Promise<{ slug: string; saleId: string }> }) {
  const { slug, saleId } = await params;
  const { business, role } = await requireAction(slug, "checkout.take");
  const data = await getSale(business.id, saleId);
  if (!data) notFound();
  const { sale, lines, payments, refunds, client, staff, products } = data;
  const cur = business.currency;
  const money = (c: number) => formatMoney(c, cur);
  const due = sale.totalCents - sale.paidCents;
  const open = sale.status === "open";
  const stripeReady = isStripeConfigured() && !!business.stripeAccountId && business.stripeChargesEnabled;
  const savedCards = stripeReady && client?.stripeCustomerId ? await listSavedCards(business.stripeAccountId!, client.stripeCustomerId).catch(() => []) : [];
  const staffOnTicket = [...new Set(lines.filter((l) => l.kind === "service").map((l) => l.staffId).filter((x): x is string => !!x))]
    .map((id) => staff.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ id: s.id, name: s.displayName }));
  const currentTips = Object.fromEntries(lines.filter((l) => l.kind === "tip" && l.staffId).map((l) => [l.staffId!, l.amountCents]));
  const goods = lines.filter((l) => l.kind !== "tip");
  const catalog = open ? await getOffersCatalog(business.id) : null;
  const credits = open && client ? await withTenant(business.id, (tx) => getClientCredits(tx, client.id)) : { packages: [], memberships: [] };
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });

  return (
    <>
      <PageHeader title={`Sale #${sale.number}`}>
        {sale.appointmentId ? <Link href={`/app/${slug}/appointments/${sale.appointmentId}`} className="text-sm text-brand-700 underline">Appointment</Link> : null}
        <Link href={`/app/${slug}/sales/${sale.id}/receipt`} className="text-sm text-brand-700 underline">Receipt</Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="font-medium">{client ? `${client.firstName} ${client.lastName}`.trim() : "Walk-in"}</p>
                <p className="text-xs text-stone-500">{fmt.format(sale.createdAt)} · <span className="uppercase">{sale.status}</span></p>
              </div>
              {open && sale.paidCents === 0 ? (
                <form action={voidOpenSale}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="saleId" value={sale.id} />
                  <Button size="sm" variant="ghost" type="submit">Void</Button>
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
                          {credits.packages.filter((p) => p.serviceId === l.serviceId).map((p) => (
                            <form key={p.id} action={useCredit}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="lineId" value={l.id} /><input type="hidden" name="source" value="package" /><input type="hidden" name="sourceId" value={p.id} /><button className="rounded border border-brand-300 bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-800">Use package ({p.remaining} left)</button></form>
                          ))}
                          {credits.memberships.filter((m) => m.creditsRemaining > 0 && (!m.includedServiceId || m.includedServiceId === l.serviceId)).map((m) => (
                            <form key={m.id} action={useCredit}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="lineId" value={l.id} /><input type="hidden" name="source" value="membership" /><input type="hidden" name="sourceId" value={m.id} /><button className="rounded border border-brand-300 bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-800">Use {m.planName} credit ({m.creditsRemaining} left)</button></form>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="w-10 py-2 text-right">
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
                {sale.taxCents > 0 ? <tr><td className="text-stone-500">Tax ({(business.taxRateBps / 100).toFixed(2)}%)</td><td className="text-right">{money(sale.taxCents)}</td><td /></tr> : null}
                {sale.tipCents > 0 ? <tr><td className="text-stone-500">Tips</td><td className="text-right">{money(sale.tipCents)}</td><td /></tr> : null}
                <tr className="text-base font-semibold"><td className="pt-2">Total</td><td className="pt-2 text-right">{money(sale.totalCents)}</td><td /></tr>
                {sale.paidCents > 0 ? <tr><td className="text-stone-500">Paid</td><td className="text-right">{money(sale.paidCents)}</td><td /></tr> : null}
                {sale.refundedCents > 0 ? <tr><td className="text-stone-500">Refunded</td><td className="text-right">−{money(sale.refundedCents)}</td><td /></tr> : null}
                {open ? <tr className="font-semibold text-brand-700"><td>Due</td><td className="text-right">{money(due)}</td><td /></tr> : null}
              </tfoot>
            </table>
          </Card>

          {open ? (
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="p-4">
                <h2 className="mb-2 font-medium">Add product</h2>
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
                      <input name="quantity" type="number" min={1} max={99} defaultValue={1} className="h-10 rounded-lg border border-stone-300 px-3 text-sm" />
                      <Select name="staffId" defaultValue={staffOnTicket[0]?.id ?? ""}>
                        <option value="">No staff credit</option>
                        {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                      </Select>
                    </div>
                    <Button type="submit" size="sm" variant="secondary">Add</Button>
                  </form>
                )}
              </Card>
              <Card className="p-4">
                <h2 className="mb-2 font-medium">Discount</h2>
                <DiscountForm key={`${sale.discountCents}:${sale.discountNote ?? ""}`} action={applyDiscount} slug={slug} saleId={sale.id} currentCents={sale.discountCents} note={sale.discountNote} />
              </Card>
              <Card className="p-4 md:col-span-2">
                <h2 className="mb-2 font-medium">Sell a gift card, package or membership</h2>
                <div className="grid gap-3 md:grid-cols-3">
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
                    <Select name="refId" required>{(catalog?.plans ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.priceCents)}/mo</option>)}</Select>
                    <Button type="submit" size="sm" variant="secondary" disabled={!client || !catalog?.plans.some((p) => p.active)}>Add membership{!client ? " (needs client)" : ""}</Button>
                  </form>
                </div>
              </Card>
              <Card className="p-4 md:col-span-2">
                <h2 className="mb-2 font-medium">Tips</h2>
                {staffOnTicket.length === 0 ? (
                  <p className="text-sm text-stone-500">Add a service line to assign tips.</p>
                ) : (
                  <TipsForm key={JSON.stringify(currentTips)} action={applyTips} slug={slug} saleId={sale.id} staff={staffOnTicket} current={currentTips} />
                )}
              </Card>
            </div>
          ) : null}

          {payments.length > 0 ? (
            <Card className="p-4">
              <h2 className="mb-2 font-medium">Payments</h2>
              <ul className="divide-y divide-stone-100 text-sm">
                {payments.map((p) => {
                  const refundable = p.amountCents - p.refundedCents;
                  return (
                    <li key={p.id} className="py-2">
                      <div className="flex items-center justify-between">
                        <span>
                          {p.method.replace("_", " ")}{p.cardBrand ? ` · ${p.cardBrand.toUpperCase()} •••• ${p.cardLast4}` : ""}
                          <span className="ml-2 text-xs uppercase text-stone-500">{p.status.replace("_", " ")}</span>
                          {p.note ? <span className="ml-2 text-xs text-stone-500">{p.note}</span> : null}
                        </span>
                        <span className="font-medium">{money(p.amountCents)}{p.refundedCents ? <span className="text-xs text-stone-500"> (−{money(p.refundedCents)})</span> : null}</span>
                      </div>
                      {refunds.filter((r) => r.paymentId === p.id).map((r) => (
                        <p key={r.id} className="text-xs text-stone-500">Refunded {money(r.amountCents)}{r.reason ? ` · ${r.reason}` : ""}</p>
                      ))}
                      {p.status !== "pending" && p.status !== "failed" && refundable > 0 && can(role, "reports.view") ? (
                        <RefundForm action={refund} slug={slug} saleId={sale.id} paymentId={p.id} maxCents={refundable} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
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
                    <div className="border-t border-stone-200 pt-4">
                      <h3 className="mb-1 text-sm font-medium text-stone-700">Card</h3>
                      {!stripeReady ? (
                        <p className="text-sm text-stone-500">
                          {can(role, "business.manage") ? <>Connect Stripe under <Link className="underline" href={`/app/${slug}/settings/payments`}>Settings → Payments</Link> to take cards.</> : "Card payments aren't set up yet."}
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
          {client ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-medium">Client</h2>
              <p>{client.firstName} {client.lastName}</p>
              {client.phone ? <p className="text-stone-600">{client.phone}</p> : null}
              {client.email ? <p className="text-stone-600">{client.email}</p> : null}
              {savedCards.length ? <p className="mt-2 text-xs text-stone-500">{savedCards.length} saved card{savedCards.length > 1 ? "s" : ""}</p> : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
