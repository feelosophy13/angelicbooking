import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { PlanFields } from "@/components/plan-fields";
import { ValidAt } from "@/components/offered-at";
import { listLocations } from "@/server/locations";
import { serviceGroups } from "@/server/service-groups";
import { createPlan } from "../../catalog-actions";

export const metadata: Metadata = { title: "New membership plan" };

export default async function NewPlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [groups, locations] = await Promise.all([serviceGroups(business, { meta: "none" }), listLocations(business.id)]);
  return (
    <FormPage title="New membership plan" backHref={`/app/${slug}/memberships`} backLabel="Membership plans">
      <ActionForm action={createPlan}>
        <input type="hidden" name="slug" value={slug} />
        <PlanFields groups={groups} />
        <ValidAt locations={locations} what="membership credits and discounts" />
        <SubmitButton pendingText="Creating…">Create plan</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
