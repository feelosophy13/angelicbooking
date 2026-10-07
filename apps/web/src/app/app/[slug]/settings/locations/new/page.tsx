import { requireAction } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/utils";
import type { Metadata } from "next";
import { FormPage, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";

export const metadata: Metadata = { title: "New location" };
import { createLocation } from "../actions";

export default async function NewLocationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "business.manage");
  return (
    <FormPage title="New location" backHref={`/app/${slug}/settings/locations`} backLabel="Locations" width="max-w-xl">
      <ActionForm action={createLocation} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name" name="name" required><Input name="name" required placeholder="Fairfax" autoFocus /></Field>
        <Field label="Phone"><Input name="phone" /></Field>
        <Field label="Address"><Input name="addressLine1" /></Field>
        <Field label="City"><Input name="city" /></Field>
        <Field label="State"><Input name="state" /></Field>
        <Field label="ZIP"><Input name="postalCode" /></Field>
        <Field label="Timezone (if different)"><Select name="timezone" defaultValue=""><option value="">Same as business</option>{TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select></Field>
        <div className="flex items-end"><SubmitButton pendingText="Creating…">Create location</SubmitButton></div>
      </ActionForm>
    </FormPage>
  );
}
