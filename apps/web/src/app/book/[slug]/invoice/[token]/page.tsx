import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBusinessForLinks } from "@/server/public-booking";
import { invoiceByToken, markInvoiceViewed, publicState } from "@/server/invoices";
import { paymentContextForSale } from "@/server/locations";
import { payOptions } from "@/lib/invoices";
import { paymentMethodLabel } from "@/lib/payment-methods";
import { formatMoney } from "@/lib/utils";
import { InvoicePay } from "./pay";

// The link is the key: keep it out of search engines and out of the Referer sent to the card form's scripts.
export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PublicInvoicePage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const business = await getBusinessForLinks(slug);
  if (!business) notFound();
  const data = await invoiceByToken(business, token);
  if (!data) notFound();
  const { invoice, sale, lines, payments, client } = data;
  const state = publicState(business, data);
  const live = state !== "paid" && state !== "void";
  if (live && !invoice.viewedAt) await markInvoiceViewed(business.id, invoice.id);
  const money = (c: number) => formatMoney(c, business.currency);
  const opts = payOptions(invoice.depositType ? { type: invoice.depositType, value: invoice.depositValue ?? 0 } : null, sale);
  const pay = await paymentContextForSale(business, sale.id);
  const canPayOnline = pay.provider === "helcim" ? pay.helcimReady : pay.ready && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const due = invoice.dueOn ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${invoice.dueOn}T12:00:00Z`)) : null;
  const paid = payments.filter((p) => p.status === "succeeded" || p.status === "partially_refunded" || p.status === "refunded");
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold">Invoice #{sale.number}</h1>
          <p className="text-sm text-stone-600">
            {state === "paid" ? <span className="font-medium text-emerald-700">Paid</span> : state === "void" ? <span className="font-medium text-stone-500">Canceled</span> : state === "overdue" ? <span className="font-medium text-red-700">Past due{due ? ` · was due ${due}` : ""}</span> : due ? `Due ${due}` : "Due on receipt"}
          </p>
        </div>
        {client ? <p className="mb-3 text-sm text-stone-600">For {`${client.firstName} ${client.lastName ?? ""}`.trim()}</p> : null}
        {invoice.note ? <p className="mb-4 whitespace-pre-line rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{invoice.note}</p> : null}
        <ul className="divide-y divide-stone-100 text-sm">
          {lines.map((l) => (
            <li key={l.id} className="flex gap-3 py-2"><span className="min-w-0 flex-1">{l.name}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</span><span className="shrink-0 tabular-nums">{money(l.amountCents)}</span></li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1 border-t border-stone-200 pt-3 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{money(sale.subtotalCents)}</dd></div>
          {sale.discountCents ? <div className="flex justify-between"><dt>Discount</dt><dd className="tabular-nums">-{money(sale.discountCents)}</dd></div> : null}
          {sale.taxCents ? <div className="flex justify-between"><dt>Tax</dt><dd className="tabular-nums">{money(sale.taxCents)}</dd></div> : null}
          <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(sale.totalCents)}</dd></div>
          {paid.map((p) => (
            <div key={p.id} className="flex justify-between text-stone-600"><dt>Paid · {paymentMethodLabel(p.method)}{p.cardLast4 ? ` ****${p.cardLast4}` : ""} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone }).format(p.createdAt)}</dt><dd className="tabular-nums">-{money(p.amountCents)}</dd></div>
          ))}
          {live ? <div className="flex justify-between text-base font-semibold"><dt>Balance due</dt><dd className="tabular-nums">{money(opts.balanceCents)}</dd></div> : null}
        </dl>
      </div>

      {state === "paid" ? (
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
          <p className="font-medium">Paid in full. Thank you!</p>
          <p className="mt-1 text-sm text-stone-600">A receipt is on its way by email.</p>
        </div>
      ) : state === "void" ? (
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-600">This invoice was canceled, so there is nothing to pay. Questions? {business.phone ? <a href={`tel:${business.phone}`} className="underline">Call {business.phone}</a> : "Contact the salon."}</div>
      ) : canPayOnline ? (
        <div className="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
          <h2 className="mb-3 text-base font-semibold">Pay by card</h2>
          <InvoicePay slug={business.slug} token={invoice.token} currency={business.currency} brand="var(--brand)" balanceCents={opts.balanceCents} depositDueCents={opts.depositDueCents} minCents={opts.minCents} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""} name={client ? `${client.firstName} ${client.lastName ?? ""}`.trim() : ""} email={invoice.sentToEmail ?? client?.email ?? ""} />
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-600">Online payment isn&apos;t available for this invoice. {business.phone ? <a href={`tel:${business.phone}`} className="underline">Call {business.phone}</a> : "Please contact the salon"} to pay.</div>
      )}
      <div className="text-center"><Link href={`/book/${business.slug}`} className="text-sm underline" style={{ color: "var(--brand)" }}>Book an appointment</Link></div>
    </div>
  );
}
