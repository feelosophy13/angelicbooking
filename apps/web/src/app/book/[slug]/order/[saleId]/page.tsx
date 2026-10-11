import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicBusiness } from "@/server/public-booking";
import { getOrder, verifyOrderKey } from "@/server/store";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ slug: string; saleId: string }>; searchParams: Promise<{ k?: string }> }) {
  const { slug, saleId } = await params;
  const { k } = await searchParams;
  const business = await getPublicBusiness(slug);
  if (!business) notFound();
  // The page shows the buyer's details and any gift card code, so the sale id alone is not enough.
  if (!verifyOrderKey(business.id, saleId, k)) notFound();
  const o = await getOrder(business.id, saleId);
  if (!o || o.sale.source !== "online") notFound();
  if (o.sale.status !== "paid") {
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-700">
        <h1 className="text-xl font-semibold">Confirming your payment…</h1>
        <p className="mt-2">Order #{o.sale.number} is being finalised. Refresh this page in a moment, or check your email for the receipt.</p>
      </div>
    );
  }
  const f = (o.sale.fulfillment ?? {}) as { method?: string; email?: string; address?: string };
  const money = (c: number) => formatMoney(c, business.currency);
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
      <h1 className="text-center text-xl font-semibold">Thank you for your order!</h1>
      <p className="mb-4 text-center text-sm text-stone-600">Order #{o.sale.number}{f.email ? ` · a receipt is on its way to ${f.email}` : ""}</p>
      <ul className="divide-y divide-stone-100 text-sm">
        {o.lines.map((l) => <li key={l.id} className="flex justify-between py-2"><span>{l.name}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</span><span>{money(l.amountCents)}</span></li>)}
        {o.sale.taxCents ? <li className="flex justify-between py-2 text-stone-500"><span>Tax</span><span>{money(o.sale.taxCents)}</span></li> : null}
        <li className="flex justify-between py-2 font-semibold"><span>Total</span><span>{money(o.sale.totalCents)}</span></li>
      </ul>
      {o.giftCards.length ? (
        <div className="mt-4 rounded-xl border-2 border-dashed p-4 text-center" style={{ borderColor: "var(--brand)" }}>
          {o.giftCards.map((g) => <p key={g.id} className="font-mono text-lg tracking-widest">{g.code} <span className="font-sans text-sm text-stone-600">· {money(g.initialCents)}</span></p>)}
          <p className="mt-1 text-xs text-stone-500">Also sent by email. Use it at checkout or mention it when booking.</p>
        </div>
      ) : null}
      <p className="mt-4 text-center text-sm text-stone-600">{f.method === "ship" ? `We'll ship to: ${f.address ?? ""}` : o.lines.some((l) => l.kind === "product") ? `We'll let you know when it's ready for pickup${business.addressLine ? ` at ${business.addressLine}` : ""}.` : ""}</p>
      <div className="mt-6 text-center"><Link href={`/book/${slug}`} className="text-sm underline" style={{ color: "var(--brand)" }}>Book an appointment</Link></div>
    </div>
  );
}
