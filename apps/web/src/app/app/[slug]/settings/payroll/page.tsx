import type { Metadata } from "next";
import Link from "next/link";
import { requireAnyAction } from "@/lib/tenant";
import { BackLink, Card, Input, PageHeader, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { savePayrollRules, savePaySchedule } from "../../payroll/actions";
import { PayScheduleFields } from "../../payroll/pay-schedule-fields";

export const metadata: Metadata = { title: "Payroll rules" };

/** The business-wide payroll settings: the pay schedule (also under Payroll → Options) and the commission rules. Per-person rates live under Staff → Pay. */
export default async function PayrollRulesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAnyAction(slug, "settings.booking", "payroll.manage");
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Payroll rules" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
        <Card className="p-5">
          <h2 className="mb-1 font-medium">Pay schedule</h2>
          <p className="mb-4 text-sm text-stone-600">Payroll opens on the current period and steps from one to the next. A salary set &ldquo;per pay period&rdquo; means one of these periods; a run over a custom range pays it pro rata by days.</p>
          <ActionForm action={savePaySchedule}>
            <input type="hidden" name="slug" value={slug} />
            <div className="grid gap-4 sm:grid-cols-2">
              <PayScheduleFields frequency={business.payFrequency} anchor={business.payAnchorDate} weekStart={business.weekStart} />
            </div>
            <SubmitButton pendingText="Saving…">Save pay schedule</SubmitButton>
          </ActionForm>
        </Card>
        <Card className="p-5">
          <h2 className="mb-1 font-medium">Commission rules</h2>
          <p className="mb-4 text-sm text-stone-600">How commission treats discounts, fees and package sessions. Each applies from the next payroll run; finalized periods keep their figures.</p>
          <ActionForm action={savePayrollRules}>
            <input type="hidden" name="slug" value={slug} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Who absorbs discounts" name="discountAbsorb" hint="A ticket discount or a member's % off. The Disc column shows it either way.">
                <Select name="discountAbsorb" defaultValue={business.discountAbsorb}>
                  <option value="provider">The provider: commission on what the client paid</option>
                  <option value="house">The house: commission as if full price was paid</option>
                  <option value="split">Split half and half</option>
                </Select>
              </Field>
              <Field label="Share of no-show and late fees to the provider (%)" name="feeSharePct" hint="Paid in full to the appointment's provider, on top of commission. 0 means the house keeps the fee.">
                <Input name="feeSharePct" type="number" step="1" min={0} max={100} defaultValue={(business.feeShareBps / 100).toString()} />
              </Field>
              <Field label="Package sessions pay commission on" name="packageRedemptionBase" hint="What the client paid per session is the default. Set when the session is used on a ticket; earlier tickets keep what they were credited.">
                <Select name="packageRedemptionBase" defaultValue={business.packageRedemptionBase}>
                  <option value="package_share">The package price per session (what the client paid)</option>
                  <option value="list">The service's list price</option>
                </Select>
              </Field>
            </div>
            <SubmitButton pendingText="Saving…">Save commission rules</SubmitButton>
          </ActionForm>
        </Card>
        </div>
        <Card className="p-4 text-xs text-stone-500">
          <p>Finalized periods can&rsquo;t overlap: once a period is finalized, the next one has to start after it. Overtime is counted per the workweek set here (weekly over 40 hours, or California&rsquo;s daily rule under Payroll → Options). Each person&rsquo;s own rates are under <Link href={`/app/${slug}/staff`} className="underline">Staff → Pay</Link>.</p>
        </Card>
      </div>
    </>
  );
}
