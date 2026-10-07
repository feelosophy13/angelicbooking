import { requireAction } from "@/lib/tenant";
import { getOffersCatalog } from "@/server/offers";
import { Button, Field, FormPage, Input, Select, Textarea } from "@/components/ui";
import { createPlan } from "../../catalog-actions";

export default async function NewPlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const { services } = await getOffersCatalog(business.id);
  return (
    <FormPage title="New membership plan" backHref={`/app/${slug}/memberships`} backLabel="Membership plans" width="max-w-lg">
      <form action={createPlan} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name"><Input name="name" required placeholder="Lash Club" autoFocus /></Field>
        <Field label="Monthly price"><Input name="price" inputMode="decimal" required placeholder="99" /></Field>
        <Field label="Included service"><Select name="includedServiceId"><option value="">None</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sessions per month"><Input name="includedSessions" type="number" min={0} defaultValue={1} /></Field>
          <Field label="Discount on other services (%)"><Input name="discountPct" type="number" min={0} max={100} defaultValue={0} /></Field>
        </div>
        <Field label="Description"><Textarea name="description" rows={2} /></Field>
        <Button type="submit">Create plan</Button>
      </form>
    </FormPage>
  );
}
