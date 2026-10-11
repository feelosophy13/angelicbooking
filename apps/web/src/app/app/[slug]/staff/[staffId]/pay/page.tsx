import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card, Input } from "@/components/ui";
import { PayFields } from "./pay-fields";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { savePay } from "../../actions";

export default async function StaffPayPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "members.manage");
  const person = await withTenant(business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) }));
  if (!person) notFound();
  return (
    <Card className="max-w-2xl p-5">
      <ActionForm action={savePay}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="staffId" value={staffId} />
        <Field label="Position" name="position" hint="Shown on payroll. Front-desk and admin roles don't generate service revenue."><Input name="position" defaultValue={person.position ?? ""} placeholder="Lash Artist" /></Field>
        <PayFields p={{ payType: person.payType, mainCommissionBps: person.mainCommissionBps, productCommissionBps: person.productCommissionBps, ccTipFeeBps: person.ccTipFeeBps, hourlyRateCents: person.hourlyRateCents, salaryPerPeriodCents: person.salaryPerPeriodCents, overtimeOverride: person.overtimeOverride, taxDeductionCents: person.taxDeductionCents, taxDeductionBps: person.taxDeductionBps }} />
        <SubmitButton pendingText="Saving…">Save pay settings</SubmitButton>
      </ActionForm>
    </Card>
  );
}
