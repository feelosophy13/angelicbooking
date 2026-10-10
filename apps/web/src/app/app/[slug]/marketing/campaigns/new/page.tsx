import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { smsAvailableFor } from "@/server/messaging";
import { Card } from "@/components/ui";
import { CampaignForm } from "../../campaign-form";
import { createCampaign } from "../../actions";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "reports.view");
  const sms = await smsAvailableFor(business.id);
  const [services, staff, locations] = await withTenant(business.id, async (tx) => [
    await tx.select({ id: schema.services.id, name: schema.services.name }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)),
    await tx.select({ id: schema.staff.id, displayName: schema.staff.displayName }).from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.displayName)),
    await tx.select({ id: schema.locations.id, name: schema.locations.name }).from(schema.locations).orderBy(asc(schema.locations.name)),
  ]);
  return (
    <Card className="max-w-3xl p-5">
      <CampaignForm action={createCampaign} slug={slug} campaign={null} services={services} staff={staff} locations={locations} submitLabel="Save draft" sms={sms} />
    </Card>
  );
}
