import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { orderStaff } from "@/lib/staff-hours";
import { FormPage, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { addOverride } from "../../staff/actions";
import { OverrideFields } from "../../staff/[staffId]/time-off/override-fields";

export const metadata: Metadata = { title: "Add time off" };

/** Team-wide entry point for days off and custom hours; the same action as a person's Time off tab. */
export default async function AddTimeOffPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ staff?: string; date?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "staff.manage");
  // Everyone active, providers first: front desk and managers take time off too.
  const people = orderStaff(
    await withTenant(business.id, (tx) =>
      tx.select({ id: schema.staff.id, name: schema.staff.displayName, takesAppointments: schema.staff.takesAppointments, sortOrder: schema.staff.sortOrder }).from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName)),
    ),
  );
  // Nobody is picked by default: choosing the wrong person silently is worse than being asked.
  const preset = people.some((p) => p.id === sp.staff) ? sp.staff! : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : "";
  return (
    <FormPage title="Add time off" backHref={`/app/${slug}/staff-hours`} backLabel="Staff hours">
      <ActionForm action={addOverride}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="returnTo" value={`/app/${slug}/staff-hours`} />
        <Field label="Who" name="staffId" required>
          <Select name="staffId" defaultValue={preset} required>
            <option value="" disabled>Choose a person</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day" name="date" required><Input type="date" name="date" defaultValue={date} required className="px-2" /></Field>
          <Field label="Last day" name="to" hint="Blank for one day"><Input type="date" name="to" className="px-2" /></Field>
        </div>
        <OverrideFields />
        <Field label="Note" name="note"><Input name="note" placeholder="Vacation, training…" /></Field>
        <SubmitButton pendingText="Adding…">Add time off</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
