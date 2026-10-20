import { eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { formatMoney, formatDateLong } from "@/lib/utils";
import { describeRate, rateAsOf } from "@/lib/pay-rates";
import { listPayRates, syncCurrentRates } from "@/server/pay-rates";
import { Card, Input } from "@/components/ui";
import { PayFields } from "./pay-fields";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { savePay } from "../../actions";

export default async function StaffPayPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "payroll.manage");
  const today = instantToISODate(new Date(), business.timezone);
  const person = await withTenant(business.id, async (tx) => {
    await syncCurrentRates(tx, today, [staffId]);
    return tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) });
  });
  if (!person) notFound();
  const history = await listPayRates(business.id, staffId);
  const current = rateAsOf(history, today);
  const upcoming = history.filter((r) => r.effectiveFrom > today);
  const money = (c: number) => formatMoney(c, business.currency);
  const userIds = [...new Set(history.map((r) => r.createdByUserId).filter((x): x is string => !!x))];
  const users = userIds.length ? await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds)) : [];
  const who = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? "a former member" : "system");
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,32rem)_minmax(0,22rem)]">
      <Card className="p-5">
        {upcoming.length ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Scheduled: {upcoming.map((r) => `${describeRate(r, money)} from ${formatDateLong(r.effectiveFrom)}`).join("; ")}. Saving below with the same date replaces it.
          </p>
        ) : null}
        <ActionForm action={savePay}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="staffId" value={staffId} />
          <Field label="Position" name="position" hint="Shown on payroll. Front-desk and admin roles don't generate service revenue."><Input name="position" defaultValue={person.position ?? ""} placeholder="Lash Artist" /></Field>
          <PayFields p={{ payType: person.payType, mainCommissionBps: person.mainCommissionBps, productCommissionBps: person.productCommissionBps, ccTipFeeBps: person.ccTipFeeBps, hourlyRateCents: person.hourlyRateCents, salaryPerPeriodCents: person.salaryPerPeriodCents, overtimeOverride: person.overtimeOverride, taxDeductionCents: person.taxDeductionCents, taxDeductionBps: person.taxDeductionBps }} />
          <div className="grid gap-4 border-t border-stone-200 pt-4 sm:grid-cols-[12rem_1fr]">
            <Field label="Takes effect from" name="effectiveFrom" required hint="Payroll for earlier periods keeps the old settings. A future date schedules the change."><Input name="effectiveFrom" type="date" defaultValue={today} required /></Field>
            <Field label="Note" name="note" hint="Why it changed, for the record."><Input name="note" placeholder="Annual review" maxLength={200} /></Field>
          </div>
          <SubmitButton pendingText="Saving…">Save pay settings</SubmitButton>
        </ActionForm>
      </Card>
      <Card className="self-start p-4 text-sm">
        <h2 className="mb-2 font-medium">Rate history</h2>
        {history.length === 0 ? <p className="text-stone-500">No changes recorded yet.</p> : (
          <ol className="space-y-3">
            {[...history].reverse().map((r) => (
              <li key={r.id} className={r === current ? "" : r.effectiveFrom > today ? "text-amber-900" : "text-stone-500"}>
                <p className="text-xs font-medium">{r.effectiveFrom > today ? "From" : "Since"} {formatDateLong(r.effectiveFrom)}{r === current ? <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800">current</span> : null}</p>
                <p>{describeRate(r, money)}</p>
                <p className="text-xs text-stone-400">{r.note ? `${r.note} · ` : ""}{who(r.createdByUserId)}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
