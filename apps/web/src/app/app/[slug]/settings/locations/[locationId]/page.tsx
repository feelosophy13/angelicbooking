import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/utils";
import { FormPage, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { updateLocation } from "../actions";

export const metadata: Metadata = { title: "Edit location" };

export default async function EditLocationPage({ params }: { params: Promise<{ slug: string; locationId: string }> }) {
  const { slug, locationId } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const l = await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId) }));
  if (!l) notFound();
  return (
    <FormPage title={l.name} backHref={`/app/${slug}/settings/locations`} backLabel="Locations" width="max-w-xl">
      <ActionForm action={updateLocation} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="locationId" value={l.id} />
        <Field label="Name" name="name" required><Input name="name" defaultValue={l.name} required autoFocus /></Field>
        <Field label="Phone" name="phone"><Input name="phone" defaultValue={l.phone ?? ""} /></Field>
        <Field label="Address" name="addressLine1"><Input name="addressLine1" defaultValue={l.addressLine1 ?? ""} /></Field>
        <Field label="City" name="city"><Input name="city" defaultValue={l.city ?? ""} /></Field>
        <Field label="State" name="state"><Input name="state" defaultValue={l.state ?? ""} /></Field>
        <Field label="ZIP" name="postalCode"><Input name="postalCode" defaultValue={l.postalCode ?? ""} /></Field>
        <Field label="Timezone (if different)" name="timezone"><Select name="timezone" defaultValue={l.timezone ?? ""}><option value="">Same as business</option>{TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select></Field>
        <div className="flex items-end"><SubmitButton pendingText="Saving…">Save location</SubmitButton></div>
      </ActionForm>
    </FormPage>
  );
}
