import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Button, Card, Input, Select } from "@/components/ui";
import { savePay } from "../../actions";

export default async function StaffPayPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "members.manage");
  const person = await withTenant(business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) }));
  if (!person) notFound();
  const L = ({ children }: { children: React.ReactNode }) => <label className="mb-1 block text-xs font-medium text-stone-600">{children}</label>;
  return (
    <Card className="max-w-3xl p-4">
      <p className="mb-3 text-xs text-stone-500">Drives the Payroll page. Commission providers are paid on service revenue; hourly and salaried staff keep tips from procedures they perform and earn the product rate on their sales. Leave withholding blank for the accountant to fill in.</p>
      <form action={savePay} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="staffId" value={staffId} />
        <div><L>Position</L><Input name="position" defaultValue={person.position ?? ""} placeholder="Lash Artist" /></div>
        <div>
          <L>Pay type</L>
          <Select name="payType" defaultValue={person.payType}>
            <option value="commission">Commission (1099)</option>
            <option value="hourly">Hourly (W-2)</option>
            <option value="salary">Salary (W-2)</option>
          </Select>
        </div>
        <div><L>Main services %</L><Input name="mainCommissionPct" type="number" step="0.5" min={0} max={100} defaultValue={(person.mainCommissionBps / 100).toString()} /></div>
        <div><L>Product/package %</L><Input name="productCommissionPct" type="number" step="0.5" min={0} max={100} defaultValue={(person.productCommissionBps / 100).toString()} /></div>
        <div><L>Fee on card tips %</L><Input name="ccTipFeePct" type="number" step="0.1" min={0} max={100} defaultValue={(person.ccTipFeeBps / 100).toString()} /></div>
        <div><L>Hourly rate ($)</L><Input name="hourlyRate" inputMode="decimal" defaultValue={person.hourlyRateCents ? (person.hourlyRateCents / 100).toFixed(2) : ""} /></div>
        <div><L>Salary per period ($)</L><Input name="salaryPerPeriod" inputMode="decimal" defaultValue={person.salaryPerPeriodCents ? (person.salaryPerPeriodCents / 100).toFixed(2) : ""} /></div>
        <div>
          <L>Overtime</L>
          <Select name="overtimeOverride" defaultValue={person.overtimeOverride == null ? "default" : person.overtimeOverride ? "yes" : "no"}>
            <option value="default">Follow payroll run</option>
            <option value="yes">Always 1.5× over 40h</option>
            <option value="no">Never (straight time)</option>
          </Select>
        </div>
        <div><L>Tax withholding ($/period)</L><Input name="taxDeductionAmount" inputMode="decimal" defaultValue={person.taxDeductionCents != null ? (person.taxDeductionCents / 100).toFixed(2) : ""} placeholder="blank = accountant" /></div>
        <div><L>or withholding %</L><Input name="taxDeductionPct" type="number" step="0.1" min={0} max={60} defaultValue={person.taxDeductionBps != null ? (person.taxDeductionBps / 100).toString() : ""} /></div>
        <div className="sm:col-span-2 lg:col-span-3"><Button type="submit">Save pay settings</Button></div>
      </form>
    </Card>
  );
}
