import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { appUrl } from "@/lib/stripe";
import { brandHex } from "@/lib/brand";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { EmbedConfigurator } from "./configurator";

export const metadata: Metadata = { title: "Embed on your website" };

export default async function EmbedSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const [services, staff, locations] = await withTenant(business.id, async (tx) => [
    await tx.select({ id: schema.services.id, name: schema.services.name }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)),
    await tx.select({ id: schema.staff.id, name: schema.staff.displayName }).from(schema.staff).where(and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true))).orderBy(asc(schema.staff.displayName)),
    await tx.select({ id: schema.locations.id, name: schema.locations.name }).from(schema.locations).orderBy(asc(schema.locations.name)),
  ]);
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Embed on your website" />
      <p className="mb-4 max-w-3xl text-sm text-stone-600">Put the booking steps straight on your own site, as a section or as a button that opens a pop-up. Clients book without leaving your page; confirmations, deposits, forms and reminders work exactly as on your booking link.</p>
      <Card className="p-5">
        <EmbedConfigurator slug={business.slug} appUrl={appUrl()} brand={brandHex(business.brandColor)} services={services.filter((s) => !!s)} staff={staff} locations={locations} />
      </Card>
    </>
  );
}
