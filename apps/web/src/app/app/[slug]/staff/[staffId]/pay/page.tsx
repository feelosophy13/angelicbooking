import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { savePay } from "../../actions";

export default async function StaffPayPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "members.manage");
  const person = await withTenant(business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) }));
  if (!person) notFound();
  return (
    <Card className="max-w-3xl p-5">
      <p className="mb-1 text-sm text-stone-600">Drives the Payroll page. Everyone keeps the tips from procedures they perform (less the card-tip fee) and earns the product rate on their sales. The other components combine however you pay this person:</p>
      <ul className="mb-4 list-disc space-y-0.5 pl-5 text-xs text-stone-500">
        <li><b>Commission (1099)</b>: a % of main-service revenue. Add an hourly rate for a guaranteed base on top of commission. No withholding.</li>
        <li><b>Hourly (W-2)</b>: rate × clocked hours (overtime optional). Add a main-services % to pay commission on top of wages.</li>
        <li><b>Salary (W-2)</b>: a flat amount per pay period, plus an optional main-services %.</li>
      </ul>
      <p className="mb-4 text-xs text-stone-500">Leave fields you don't use at 0. Leave withholding blank for the accountant to fill in.</p>
      <ActionForm action={savePay} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="staffId" value={staffId} />
        <Field label="Position" name="position" hint="Receptionist, manager, front desk and admin roles don't generate service revenue."><Input name="position" defaultValue={person.position ?? ""} placeholder="Lash Artist" /></Field>
        <Field label="Pay type" name="payType">
          <Select name="payType" defaultValue={person.payType}>
            <option value="commission">Commission (1099)</option>
            <option value="hourly">Hourly (W-2)</option>
            <option value="salary">Salary (W-2)</option>
          </Select>
        </Field>
        <Field label="Main services %" name="mainCommissionPct" hint="Commission on service revenue. 0 = none."><Input name="mainCommissionPct" type="number" step="0.5" min={0} max={100} defaultValue={(person.mainCommissionBps / 100).toString()} /></Field>
        <Field label="Product / package %" name="productCommissionPct"><Input name="productCommissionPct" type="number" step="0.5" min={0} max={100} defaultValue={(person.productCommissionBps / 100).toString()} /></Field>
        <Field label="Fee on card tips %" name="ccTipFeePct"><Input name="ccTipFeePct" type="number" step="0.1" min={0} max={100} defaultValue={(person.ccTipFeeBps / 100).toString()} /></Field>
        <Field label="Hourly rate ($)" name="hourlyRate" hint="Paid on time-clock hours (hourly staff, or a base for commission providers)."><Input name="hourlyRate" inputMode="decimal" defaultValue={person.hourlyRateCents ? (person.hourlyRateCents / 100).toFixed(2) : ""} /></Field>
        <Field label="Salary per period ($)" name="salaryPerPeriod" hint="Salaried staff only."><Input name="salaryPerPeriod" inputMode="decimal" defaultValue={person.salaryPerPeriodCents ? (person.salaryPerPeriodCents / 100).toFixed(2) : ""} /></Field>
        <Field label="Overtime" name="overtimeOverride">
          <Select name="overtimeOverride" defaultValue={person.overtimeOverride == null ? "default" : person.overtimeOverride ? "yes" : "no"}>
            <option value="default">Follow payroll run</option>
            <option value="yes">Always 1.5× over 40 h</option>
            <option value="no">Never (straight time)</option>
          </Select>
        </Field>
        <Field label="Tax withholding ($ per period)" name="taxDeductionAmount"><Input name="taxDeductionAmount" inputMode="decimal" defaultValue={person.taxDeductionCents != null ? (person.taxDeductionCents / 100).toFixed(2) : ""} placeholder="blank = accountant" /></Field>
        <Field label="or withholding %" name="taxDeductionPct"><Input name="taxDeductionPct" type="number" step="0.1" min={0} max={60} defaultValue={person.taxDeductionBps != null ? (person.taxDeductionBps / 100).toString() : ""} /></Field>
        <div className="sm:col-span-2 lg:col-span-3"><SubmitButton pendingText="Saving…">Save pay settings</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}
