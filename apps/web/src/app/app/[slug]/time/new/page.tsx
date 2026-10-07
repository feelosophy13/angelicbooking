import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { Button, Field, FormPage, Input, Select } from "@/components/ui";
import { addTimeEntry } from "../actions";

export default async function NewTimeEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "staff.manage");
  const staff = await withTenant(business.id, (tx) => tx.select().from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.displayName)));
  const today = instantToISODate(new Date(), business.timezone);
  return (
    <FormPage title="Add hours" backHref={`/app/${slug}/time`} backLabel="Time clock" width="max-w-md">
      <form action={addTimeEntry} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <Field label="Staff"><Select name="staffId">{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" name="date" defaultValue={today} required /></Field>
        <Field label="Hours"><Input name="hours" type="number" step="0.25" min={0} max={24} required autoFocus /></Field>
        <Field label="Note"><Input name="note" placeholder="Optional" /></Field>
        <Button type="submit">Add hours</Button>
      </form>
    </FormPage>
  );
}
