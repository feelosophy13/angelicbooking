import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicBusiness, getPublicLocations } from "@/server/public-booking";
import { StoreLocationPicker } from "./location-picker";
import { storeProducts, storeReady } from "@/server/store";
import { currentClient } from "@/server/client-auth";
import { brandHex } from "@/lib/brand";
import { StoreCheckout } from "./checkout";
import { productLabel } from "@/lib/inventory";

export default async function ShopPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ location?: string }> }) {
  const { slug } = await params;
  const { location: locParam } = await searchParams;
  const business = await getPublicBusiness(slug);
  if (!business || !business.storeEnabled) notFound();
  const locations = await getPublicLocations(business.id);
  const location = locations.length > 1 ? (locations.find((l) => l.id === locParam) ?? locations.find((l) => l.isDefault) ?? locations[0] ?? null) : null;
  const ready = await storeReady(business, location?.id);
  const [rows, me] = await Promise.all([storeProducts(business.id, location?.id), business.clientAccountsEnabled ? currentClient(business) : Promise.resolve(null)]);
  const products = rows.map(({ p, category, available }) => ({ id: p.id, name: productLabel(p), priceCents: p.priceCents, description: p.description, imageUrl: p.imageUrl, category, stockQty: available ?? 0, trackStock: available != null }));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Shop</h1>
        {business.giftCardsOnline ? <Link href={`/book/${slug}/gift${location ? `?location=${location.id}` : ""}`} className="text-sm underline" style={{ color: "var(--brand)" }}>Buy a gift card</Link> : null}
      </div>
      <StoreLocationPicker locations={locations} current={location?.id ?? null} base={`/book/${slug}/shop`} />
      {!ready ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Online ordering is being set up. Please call or visit us.</p> : products.length === 0 ? <p className="text-sm text-stone-600">Nothing is listed online yet.</p> : (
        <StoreCheckout slug={slug} currency={business.currency} products={products} shippingFlatCents={business.shippingFlatCents} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!} brand={brandHex(business.brandColor)} locationId={location?.id ?? null} defaults={me ? { firstName: me.firstName, lastName: me.lastName, email: me.email, phone: me.phone } : null} />
      )}
    </div>
  );
}
