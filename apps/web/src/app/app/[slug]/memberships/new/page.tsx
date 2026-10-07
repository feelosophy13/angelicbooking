import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { getOffersCatalog } from "@/server/offers";
import { FormPage, Input, Select, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { createPlan } from "../../catalog-actions";

export const metadata: Metadata = { title: "New membership plan" };

export default async function NewPlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const { services } = await getOffersCatalog(business.id);
  return (
    <FormPage title="New membership plan" backHref={`/app/${slug}/memberships`} backLabel="Membership plans" width="max-w-lg">
      <ActionForm action={createPlan}>
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name" name="name" required><Input name="name" required placeholder="Lash Club" autoFocus /></Field>
        <Field label="Monthly price" name="price" required><Input name="price" inputMode="decimal" required placeholder="99" /></Field>
        <Field label="Included service" name="includedServiceId"><Select name="includedServiceId"><option value="">None</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sessions per month" name="includedSessions"><Input name="includedSessions" type="number" min={0} defaultValue={1} /></Field>
          <Field label="Discount on other services (%)" name="discountPct"><Input name="discountPct" type="number" min={0} max={100} defaultValue={0} /></Field>
        </div>
        <Field label="Description" name="description"><Textarea name="description" rows={2} /></Field>
        <SubmitButton pendingText="Creating…">Create plan</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
