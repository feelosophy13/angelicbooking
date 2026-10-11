import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { serviceGroups } from "@/server/service-groups";
import { FormPage } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { PackageFields } from "@/components/package-fields";
import { listLocations } from "@/server/locations";
import { createPackage } from "../../catalog-actions";

export const metadata: Metadata = { title: "New package" };

export default async function NewPackagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [locations, groups] = await Promise.all([listLocations(business.id), serviceGroups(business, { meta: "none" })]);
  return (
    <FormPage title="New package" backHref={`/app/${slug}/packages`} backLabel="Packages">
      <ActionForm action={createPackage}>
        <input type="hidden" name="slug" value={slug} />
        <PackageFields groups={groups} locations={locations} currency={business.currency} />
        <SubmitButton pendingText="Creating…">Create package</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
