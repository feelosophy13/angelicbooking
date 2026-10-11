import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { serviceGroups } from "@/server/service-groups";
import { ServicePicker } from "@/components/service-picker";
import { FormPage, Input, Textarea } from "@/components/ui";
import { ImageField } from "@/components/image-field";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { ValidAt } from "@/components/offered-at";
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
        <Field label="Name" name="name" required><Input name="name" required placeholder="5 Lash Fills" autoFocus /></Field>
        <Field label="Service" name="serviceId" hint="Choose one service, or let sessions be used on any service (e.g. a mixed facial bundle)."><ServicePicker name="serviceId" groups={groups} value={null} placeholder="Any service" noneLabel="Any service" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sessions" name="sessions" required><Input name="sessions" type="number" min={1} defaultValue={5} required /></Field>
          <Field label="Price" name="price" required><Input name="price" inputMode="decimal" required placeholder="275" /></Field>
        </div>
        <Field label="Valid for (days)" name="validDays" hint="Leave blank if sessions never expire."><Input name="validDays" type="number" min={1} placeholder="365" /></Field>
        <Field label="Description" name="description"><Textarea name="description" rows={3} /></Field>
        <Field label="Photo" name="image" className="mt-2"><ImageField name="image" current={null} /></Field>
        <ValidAt locations={locations} what="package sessions" />
        <SubmitButton pendingText="Creating…">Create package</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
