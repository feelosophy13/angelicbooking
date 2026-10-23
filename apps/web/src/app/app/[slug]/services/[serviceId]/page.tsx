import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { paymentsHrefFor } from "@/lib/nav";
import { isStripeConfigured } from "@/lib/stripe";
import { listCategories } from "@/server/categories";
import { FormPage } from "@/components/ui";
import { PricesByStylist } from "./prices-by-stylist";
import { AddonsCard } from "./addons-card";
import { listAddons } from "@/server/addons";
import { ActionForm, SubmitButton } from "@/components/form";
import { ServiceFields } from "@/components/service-fields";
import { aiConfigured } from "@/server/ai";
import { updateService } from "../actions";
import { listLocations } from "@/server/locations";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; serviceId: string }> }): Promise<Metadata> {
  const { slug, serviceId } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const s = await withTenant(business.id, (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, serviceId) }));
  return { title: s ? `${s.name} · Services` : "Service" };
}

export default async function EditServicePage({ params }: { params: Promise<{ slug: string; serviceId: string }> }) {
  const { slug, serviceId } = await params;
  const { business, permissions } = await requireAction(slug, "services.manage");
  const [service, categories, locations, offeredAt] = await Promise.all([
    withTenant(business.id, (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, serviceId) })),
    listCategories(business.id, "service"),
    listLocations(business.id),
    withTenant(business.id, (tx) => tx.select({ locationId: schema.serviceLocations.locationId }).from(schema.serviceLocations).where(eq(schema.serviceLocations.serviceId, serviceId))),
  ]);
  if (!service) notFound();
  const [addons, others] = await Promise.all([
    listAddons(business.id, service.id),
    withTenant(business.id, (tx) => tx.select({ id: schema.services.id, name: schema.services.name, priceCents: schema.services.priceCents, durationMin: schema.services.durationMin, capacity: schema.services.capacity }).from(schema.services).where(eq(schema.services.active, true)).orderBy(schema.services.name)),
  ]);
  return (
    <>
    <FormPage title={service.name} backHref={service.categoryId ? `/app/${slug}/services/categories/${service.categoryId}` : `/app/${slug}/services`} backLabel={service.categoryId ? (categories.find((c) => c.id === service.categoryId)?.name ?? "Services") : "Services"}>
      <ActionForm action={updateService}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="serviceId" value={service.id} />
        <ServiceFields aiSlug={aiConfigured() ? slug : undefined} service={service} categories={categories} locations={locations} offeredAt={offeredAt.map((r) => r.locationId)} currency={business.currency} stripeReady={isStripeConfigured() && business.stripeChargesEnabled} paymentsHref={paymentsHrefFor(slug, permissions)} />
        <SubmitButton pendingText="Saving…">Save service</SubmitButton>
      </ActionForm>
    </FormPage>
    <PricesByStylist slug={slug} businessId={business.id} currency={business.currency} service={service} />
    {service.capacity === 1 ? (
      <AddonsCard
        key={JSON.stringify(addons)}
        slug={slug}
        serviceId={service.id}
        currency={business.currency}
        options={others.filter((o) => o.id !== service.id && o.capacity === 1)}
        initial={addons.map((a) => ({ addonServiceId: a.addonServiceId, mode: a.priceCents != null ? "fixed" : a.discountCents != null ? "off" : "regular", amount: a.priceCents != null ? (a.priceCents / 100).toFixed(2) : a.discountCents != null ? (a.discountCents / 100).toFixed(2) : "", minutes: a.durationMin != null ? String(a.durationMin) : "" }))}
      />
    ) : null}
    </>
  );
}
