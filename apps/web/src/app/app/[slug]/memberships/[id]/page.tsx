import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { getOffersCatalog } from "@/server/offers";
import { listLocations } from "@/server/locations";
import { FormPage, Input, Select, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { ValidAt } from "@/components/offered-at";
import { updatePlan } from "../../catalog-actions";

export const metadata: Metadata = { title: "Edit membership plan" };

export default async function EditPlanPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [p, { services }, locations] = await Promise.all([
    withTenant(business.id, (tx) => tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, id) })),
    getOffersCatalog(business.id),
    listLocations(business.id),
  ]);
  if (!p) notFound();
  return (
    <FormPage title={p.name} backHref={`/app/${slug}/memberships`} backLabel="Membership plans" width="max-w-lg">
      <p className="mb-3 text-xs text-stone-500">Price changes apply to new sales; members on auto-renew keep the Stripe price they signed up with until it is set up again.</p>
      <ActionForm action={updatePlan}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={p.id} />
        <Field label="Name" name="name" required><Input name="name" defaultValue={p.name} required autoFocus /></Field>
        <Field label="Monthly price" name="price" required><Input name="price" inputMode="decimal" defaultValue={(p.priceCents / 100).toFixed(2)} required /></Field>
        <Field label="Included service" name="includedServiceId"><Select name="includedServiceId" defaultValue={p.includedServiceId ?? ""}><option value="">None</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sessions per month" name="includedSessions"><Input name="includedSessions" type="number" min={0} defaultValue={p.includedSessions} /></Field>
          <Field label="Discount on other services (%)" name="discountPct"><Input name="discountPct" type="number" min={0} max={100} defaultValue={p.discountBps / 100} /></Field>
        </div>
        <Field label="Description" name="description"><Textarea name="description" rows={2} defaultValue={p.description ?? ""} /></Field>
        <ValidAt locations={locations} selected={p.validLocationIds} what="membership credits and discounts" />
        <SubmitButton pendingText="Saving…">Save plan</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
