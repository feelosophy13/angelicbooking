import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { serviceGroups } from "@/server/service-groups";
import { listLocations } from "@/server/locations";
import { FormPage } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { PackageFields } from "@/components/package-fields";
import { updatePackage } from "../../catalog-actions";

export const metadata: Metadata = { title: "Edit package" };

export default async function EditPackagePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [p, groups, locations] = await Promise.all([
    withTenant(business.id, (tx) => tx.query.packages.findFirst({ where: eq(schema.packages.id, id) })),
    serviceGroups(business, { meta: "none" }),
    listLocations(business.id),
  ]);
  if (!p) notFound();
  return (
    <FormPage title={p.name} backHref={`/app/${slug}/packages`} backLabel="Packages">
      <p className="mb-3 text-xs text-stone-500">Changes apply to packages sold from now on; sessions already bought keep their count and expiry.</p>
      <ActionForm action={updatePackage}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={p.id} />
        <PackageFields pkg={p} groups={groups} locations={locations} currency={business.currency} />
        <SubmitButton pendingText="Saving…">Save package</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
