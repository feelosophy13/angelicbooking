import type { Metadata } from "next";
import Link from "next/link";
import { requireAnyAction } from "@/lib/tenant";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { savePaySchedule } from "../../payroll/actions";
import { PayScheduleFields } from "../../payroll/pay-schedule-fields";

export const metadata: Metadata = { title: "Payroll rules" };

/** The business-wide payroll settings: the pay schedule (also under Payroll → Options). Per-person rates live under Staff → Pay. */
export default async function PayrollRulesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAnyAction(slug, "settings.booking", "payroll.manage");
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Payroll rules" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
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
        <Card className="p-4 text-xs text-stone-500">
          <p>Finalized periods can&rsquo;t overlap: once a period is finalized, the next one has to start after it. Overtime is counted per the workweek set here (weekly over 40 hours, or California&rsquo;s daily rule under Payroll → Options). Each person&rsquo;s own rates are under <Link href={`/app/${slug}/staff`} className="underline">Staff → Pay</Link>.</p>
        </Card>
      </div>
    </>
  );
}
