import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { paymentsHrefFor } from "@/lib/nav";
import { isStripeConfigured } from "@/lib/stripe";
import { listCategories } from "@/server/categories";
import { FormPage } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { ServiceFields } from "@/components/service-fields";
import { createService } from "../actions";
import { listLocations } from "@/server/locations";

export const metadata: Metadata = { title: "New service" };

export default async function NewServicePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ category?: string }> }) {
  const { slug } = await params;
  const { category } = await searchParams;
  const { business, permissions } = await requireAction(slug, "services.manage");
  const [categories, locations] = await Promise.all([listCategories(business.id, "service"), listLocations(business.id)]);
  return (
    <FormPage title="New service" backHref={`/app/${slug}/services`} backLabel="Services">
      <ActionForm action={createService}>
        <input type="hidden" name="slug" value={slug} />
        <ServiceFields categories={categories} locations={locations} offeredAt={[]} defaultCategoryId={categories.some((c) => c.id === category) ? category : null} currency={business.currency} stripeReady={isStripeConfigured() && business.stripeChargesEnabled} paymentsHref={paymentsHrefFor(slug, permissions)} />
        <SubmitButton pendingText="Saving…">Create service</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
