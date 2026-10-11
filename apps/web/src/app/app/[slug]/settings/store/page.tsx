import type { Metadata } from "next";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { appUrl, isStripeConfigured } from "@/lib/stripe";
import { BackLink, Card, Input, PageHeader, Notice, Checkbox, MoneyInput } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveStoreSettings } from "./actions";

export const metadata: Metadata = { title: "Online store" };

export default async function StoreSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const ready = isStripeConfigured() && business.stripeChargesEnabled;
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Online store" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-4">
          {!ready ? <div className="mb-4"><Notice>Online payments need Stripe connected under <Link className="underline" href={`/app/${slug}/settings/payments`}>Settings → Payments</Link>. The pages show a “being set up” notice until then.</Notice></div> : null}
          <ActionForm action={saveStoreSettings}>
            <input type="hidden" name="slug" value={slug} />
            <Checkbox name="giftCardsOnline" defaultChecked={business.giftCardsOnline} label="Sell gift cards online" />
            <p className="-mt-2 text-xs text-stone-500">Clients pick an amount, add a recipient and message, and the code is emailed when paid. <a className="underline" href={appUrl(`/book/${business.slug}/gift`)} target="_blank" rel="noreferrer">{appUrl(`/book/${business.slug}/gift`)}</a></p>
            <Checkbox name="storeEnabled" defaultChecked={business.storeEnabled} label="Sell products online" />
            <p className="-mt-2 text-xs text-stone-500">Products marked “sell online” appear at <a className="underline" href={appUrl(`/book/${business.slug}/shop`)} target="_blank" rel="noreferrer">{appUrl(`/book/${business.slug}/shop`)}</a>. Orders show up under Sales with a pickup/shipping note.</p>
            <Field label="Flat shipping rate" name="shippingFlat" hint="Leave at 0 for pickup only."><MoneyInput name="shippingFlat" defaultValue={business.shippingFlatCents ? (business.shippingFlatCents / 100).toFixed(2) : ""} className="w-40" /></Field>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
        <Card className="p-4 text-sm text-stone-600">
          <h2 className="mb-1 font-medium text-stone-900">Stock</h2>
          <p>Products with stock tracking show “only N left” and sell out automatically. Manage quantities on each product.</p>
        </Card>
      </div>
    </>
  );
}
