import { asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { formatDateLong } from "@/lib/utils";
import type { Metadata } from "next";
import { FormPage, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";

export const metadata: Metadata = { title: "Add payroll adjustment" };
import { addAdjustment } from "../../actions";

export default async function NewAdjustmentPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ start?: string; end?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "payroll.view");
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDate(sp.start) || !isDate(sp.end)) throw new Error("Pick a pay period on the Payroll page first.");
  const staff = await withTenant(business.id, (tx) => tx.select().from(schema.staff).orderBy(asc(schema.staff.displayName)));
  return (
    <FormPage title="Add payroll adjustment" backHref={`/app/${slug}/payroll?start=${sp.start}&end=${sp.end}`} backLabel="Payroll" width="max-w-md">
      <p className="mb-3 text-sm text-stone-600">Pay period {formatDateLong(sp.start!)} – {formatDateLong(sp.end!)}. Added to the person\u2019s check before tax; use a negative amount to subtract.</p>
      <ActionForm action={addAdjustment}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="start" value={sp.start} />
        <input type="hidden" name="end" value={sp.end} />
        <Field label="Employee" name="staffId"><Select name="staffId">{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</Select></Field>
        <Field label="Label" name="label" required><Input name="label" placeholder="Missed Pay from Training" required autoFocus /></Field>
        <Field label="Amount" name="amount" required><Input name="amount" inputMode="decimal" placeholder="142.90" required /></Field>
        <SubmitButton pendingText="Adding…">Add adjustment</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
