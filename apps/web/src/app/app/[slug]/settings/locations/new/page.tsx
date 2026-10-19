import { requireAction } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/utils";
import type { Metadata } from "next";
import { FormPage, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { HoursEditor } from "@/components/hours-editor";

export const metadata: Metadata = { title: "New location" };
import { createLocation } from "../actions";

export default async function NewLocationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "settings.business");
  return (
    <FormPage title="New location" backHref={`/app/${slug}/settings/locations`} backLabel="Locations">
      <ActionForm action={createLocation} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name" name="name" required><Input name="name" required placeholder="Fairfax" autoFocus /></Field>
        <Field label="Phone"><Input name="phone" /></Field>
        <Field label="Address"><Input name="addressLine1" /></Field>
        <Field label="City"><Input name="city" /></Field>
        <Field label="State"><Input name="state" /></Field>
        <Field label="ZIP"><Input name="postalCode" /></Field>
        <Field label="Timezone (if different)"><Select name="timezone" defaultValue=""><option value="">Same as business</option>{TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select></Field>
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium text-stone-700">Opening hours</p>
          <p className="mb-2 text-xs text-stone-500">Shown on the booking page and used as the outer limit for online bookings at this location.</p>
          <HoursEditor initial={null} />
        </div>
        <div className="flex items-end"><SubmitButton pendingText="Creating…">Create location</SubmitButton></div>
      </ActionForm>
    </FormPage>
  );
}
