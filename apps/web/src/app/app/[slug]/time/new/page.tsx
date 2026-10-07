import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { FormPage, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { addTimeEntry } from "../actions";

export const metadata: Metadata = { title: "Add hours" };

export default async function NewTimeEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "staff.manage");
  const staff = await withTenant(business.id, (tx) => tx.select().from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.displayName)));
  const today = instantToISODate(new Date(), business.timezone);
  return (
    <FormPage title="Add hours" backHref={`/app/${slug}/time`} backLabel="Time clock" width="max-w-md">
      <ActionForm action={addTimeEntry}>
        <input type="hidden" name="slug" value={slug} />
        <Field label="Staff" name="staffId"><Select name="staffId">{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</Select></Field>
        <Field label="Date" name="date" required><Input type="date" name="date" defaultValue={today} required /></Field>
        <Field label="Hours" name="hours" required hint="Quarter hours are fine, e.g. 7.25"><Input name="hours" type="number" step="0.25" min={0} max={24} required autoFocus /></Field>
        <Field label="Note" name="note"><Input name="note" placeholder="Optional" /></Field>
        <SubmitButton pendingText="Adding…">Add hours</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
