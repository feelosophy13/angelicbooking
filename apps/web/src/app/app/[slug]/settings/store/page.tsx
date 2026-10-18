import type { Metadata } from "next";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { appUrl, isStripeConfigured } from "@/lib/stripe";
import { BackLink, Card, PageHeader, Notice } from "@/components/ui";
import { StoreForm } from "./store-form";
import { paymentsHrefFor } from "@/lib/nav";

export const metadata: Metadata = { title: "Online store" };

export default async function StoreSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireAction(slug, "business.manage");
  const ready = isStripeConfigured() && business.stripeChargesEnabled;
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Online store" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-4">
          {!ready ? <div className="mb-4"><Notice>Online payments need Stripe connected{paymentsHrefFor(slug, permissions) ? <> under <Link className="underline" href={paymentsHrefFor(slug, permissions)!}>Settings → Payments</Link></> : " (ask the owner)"}. The pages show a “being set up” notice until then.</Notice></div> : null}
          <StoreForm slug={slug} giftCardsOnline={business.giftCardsOnline} storeEnabled={business.storeEnabled} shippingFlatCents={business.shippingFlatCents} giftUrl={appUrl(`/book/${business.slug}/gift`)} shopUrl={appUrl(`/book/${business.slug}/shop`)} />
        </Card>
        {business.storeEnabled ? (
          <Card className="p-4 text-sm text-stone-600">
            <h2 className="mb-1 font-medium text-stone-900">Stock</h2>
            <p>Products with stock tracking show “only N left” and sell out automatically. Manage quantities on each product.</p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
