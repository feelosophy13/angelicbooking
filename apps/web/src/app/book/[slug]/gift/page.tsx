import { notFound } from "next/navigation";
import { getPublicBusiness } from "@/server/public-booking";
import { GIFT_PRESETS_CENTS, storeReady } from "@/server/store";
import { currentClient } from "@/server/client-auth";
import { brandHex } from "@/lib/brand";
import { StoreCheckout } from "../shop/checkout";

export default async function GiftPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getPublicBusiness(slug);
  if (!business || !business.giftCardsOnline) notFound();
  const me = business.clientAccountsEnabled ? await currentClient(business) : null;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Gift card</h1>
        <p className="text-sm text-stone-600">Delivered by email with a code to use at {business.name}. Pay securely with a card.</p>
      </div>
      {!storeReady(business) ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Online gift cards are being set up. Please call or visit us to buy one.</p> : (
        <StoreCheckout slug={slug} currency={business.currency} products={[]} shippingFlatCents={0} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!} brand={brandHex(business.brandColor)} gift={{ presets: GIFT_PRESETS_CENTS }} defaults={me ? { firstName: me.firstName, lastName: me.lastName, email: me.email, phone: me.phone } : null} />
      )}
    </div>
  );
}
