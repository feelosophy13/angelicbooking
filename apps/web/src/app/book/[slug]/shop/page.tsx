import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicBusiness } from "@/server/public-booking";
import { storeProducts, storeReady } from "@/server/store";
import { currentClient } from "@/server/client-auth";
import { brandHex } from "@/lib/brand";
import { StoreCheckout } from "./checkout";

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getPublicBusiness(slug);
  if (!business || !business.storeEnabled) notFound();
  const [rows, me] = await Promise.all([storeProducts(business.id), business.clientAccountsEnabled ? currentClient(business) : Promise.resolve(null)]);
  const products = rows.map(({ p, category }) => ({ id: p.id, name: p.name, priceCents: p.priceCents, description: p.description, imageUrl: p.imageUrl, category, stockQty: p.stockQty, trackStock: p.trackStock }));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Shop</h1>
        {business.giftCardsOnline ? <Link href={`/book/${slug}/gift`} className="text-sm underline" style={{ color: "var(--brand)" }}>Buy a gift card</Link> : null}
      </div>
      {!storeReady(business) ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Online ordering is being set up. Please call or visit us.</p> : products.length === 0 ? <p className="text-sm text-stone-600">Nothing is listed online yet.</p> : (
        <StoreCheckout slug={slug} currency={business.currency} products={products} shippingFlatCents={business.shippingFlatCents} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!} brand={brandHex(business.brandColor)} defaults={me ? { firstName: me.firstName, lastName: me.lastName, email: me.email, phone: me.phone } : null} />
      )}
    </div>
  );
}
