import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listLocations } from "@/server/locations";
import { FormPage } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { PlanFields } from "@/components/plan-fields";
import { ValidAt } from "@/components/offered-at";
import { updatePlan } from "../../catalog-actions";
import { serviceGroups } from "@/server/service-groups";

export const metadata: Metadata = { title: "Edit membership plan" };

export default async function EditPlanPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [p, groups, locations] = await Promise.all([

    withTenant(business.id, (tx) => tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, id) })),
    serviceGroups(business, { meta: "none" }),
    listLocations(business.id),
  ]);
  if (!p) notFound();
  return (
    <FormPage title={p.name} backHref={`/app/${slug}/memberships`} backLabel="Membership plans">
      <p className="mb-3 text-xs text-stone-500">Price and billing changes apply to new sales; members on auto-renew keep the price and cadence they signed up with until auto-renew is set up again.</p>
      <ActionForm action={updatePlan}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={p.id} />
        <PlanFields plan={p} groups={groups} />
        <ValidAt locations={locations} selected={p.validLocationIds} what="membership credits and discounts" />
        <SubmitButton pendingText="Saving…">Save plan</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
