import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { ConfirmSubmit } from "@/components/form";
import { dateShort } from "@/lib/format";

export const metadata: Metadata = { title: "Payroll" };
import { can, instantToISODate, isScheduledPeriod, nextPeriod, onSheet, PAY_FREQUENCY_LABEL, periodContaining, previousPeriod, rateLabel } from "@angelic/core";
import { requireAnyAction } from "@/lib/tenant";
import { driftFromSnapshot, forHomeLocation, forOwnRow, listPayrollRuns, payrollForPeriod, resolveSchedule, salaryShareFor } from "@/server/payroll";
import { formatDateLong, formatMoney } from "@/lib/utils";
import { Button, Card, Input, LinkButton, PageHeader, Empty, Notice } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { ActionForm, SubmitButton } from "@/components/form";
import { deleteAdjustment, finalize, markPaid, savePaySchedule, setOvertimeRule, unmarkPaid } from "./actions";
import { OvertimeOptions } from "./overtime-options";
import { PayScheduleFields } from "./pay-schedule-fields";
import { LocationFilter } from "@/components/location-filter";
import { listLocations } from "@/server/locations";
import { and, gte, ilike, lte } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";

export default async function PayrollPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ start?: string; end?: string; overtime?: string | string[]; location?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  // Everyone's pay with "Run payroll for everyone"; with "See their own pay sheet" alone, the page is this person's own row and nothing else.
  const { business, permissions, staffId: myStaffId } = await requireAnyAction(slug, "payroll.manage", "payroll.view.own");
  const manage = can(permissions, "payroll.manage");
  const today = instantToISODate(new Date(), business.timezone);
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  // The page opens on the scheduled period containing today; Previous / Next step through the schedule, and a custom range is a one-off.
  const { schedule, configured: scheduleSet } = await resolveSchedule(business, today);
  const cur = periodContaining(schedule, today);
  const start = isDate(sp.start) ? sp.start! : cur.start;
  const end = isDate(sp.end) ? sp.end! : cur.end;
  // Overtime is on unless the run turns it off (hourly staff are owed it by law; people set to "never" in their pay settings still get none).
  // The form sends "0" before the checkbox, so the last value is the box's state.
  const otParam = Array.isArray(sp.overtime) ? sp.overtime.at(-1) : sp.overtime;
  const overtimeAsked = otParam !== "0";
  const period = { start, end };
  const scheduled = isScheduledPeriod(schedule, period);
  const prev = previousPeriod(schedule, period);
  const next = nextPeriod(schedule, period);
  const salary = await salaryShareFor(business, period, today);
  const locations = await listLocations(business.id);
  const locationFilter = locations.some((l) => l.id === sp.location) ? sp.location! : null;
  // A finalized period shows what was finalized (the saved snapshot) and keeps the overtime setting it was finalized with; live figures
  // sit behind "What changed since". A location is the people based there, with all of their pay (one sheet per site, the owner's way).
  const [{ result: whole, live, finalized, overtime }, runs] = await Promise.all([payrollForPeriod(business, period, overtimeAsked), listPayrollRuns(business.id)]);
  const result = manage ? forHomeLocation(whole, locationFilter) : forOwnRow(whole, myStaffId ?? null);
  const paid = !!finalized?.paidOn;
  const money = (c: number) => formatMoney(c, business.currency);
  // "6.00 OT, 1.00 double, incl. $40.00 OT on commission"
  const otText = (e: (typeof result.employees)[number]) =>
    [`${(e.overtimeMinutes / 60).toFixed(2)} OT`, e.doubleMinutes ? `${(e.doubleMinutes / 60).toFixed(2)} double` : null, e.overtimeOnCommissionCents ? `incl. ${money(e.overtimeOnCommissionCents)} OT on commission and bonuses` : null].filter(Boolean).join(", ");
  // Everyone with activity, plus a $0 row for each active hourly or salaried person with nothing clocked or sold (a missed clock-in shows).
  const active = result.employees.filter(onSheet);
  const unassigned = result.omitted.filter((o) => o.reason === "no staff credited");
  const unassignedCents = unassigned.reduce((n, o) => n + o.amountCents, 0);
  const unconfigured = result.employees.filter((e) => e.hasActivity && e.employee.payType === "commission" && e.employee.mainCommissionBps === 0 && e.mainRevenueCents > 0);
  const qs = `start=${start}&end=${end}&overtime=${overtime ? 1 : 0}${locationFilter ? `&location=${locationFilter}` : ""}`;
  const hrefFor = (p: { start: string; end: string }) => `?start=${p.start}&end=${p.end}&overtime=${overtime ? 1 : 0}${locationFilter ? `&location=${locationFilter}` : ""}`;
  const salaried = active.some((e) => e.employee.payType === "salary" && e.employee.salaryPerPeriodCents > 0);
  // Shifts the clock closed by itself (no clock-out for 14 hours) are paid at the cap until someone corrects them.
  const autoClosed = await withTenant(business.id, (tx) =>
    tx
      .select({ staffId: schema.timeEntries.staffId, date: schema.timeEntries.date })
      .from(schema.timeEntries)
      .where(and(gte(schema.timeEntries.date, start), lte(schema.timeEntries.date, end), ilike(schema.timeEntries.note, "%Auto clock-out%"))),
  );
  // A finalized period should not change; if it did (a tip added to an old ticket, an edit made before periods were locked), say who and by how much.
  const drift = manage && finalized ? driftFromSnapshot(finalized.snapshot, manage ? forHomeLocation(live, locationFilter) : live) : [];
  const totals = active.reduce((t, e) => ({ total: t.total + e.totalCents, tips: t.tips + e.cashTipsCents + e.cardTipsCents, rev: t.rev + e.serviceRevenueCents }), { total: 0, tips: 0, rev: 0 });

  return (
    <>
      <PageHeader title={manage ? "Payroll" : "My pay"}>
        {can(permissions, "reports.view") ? <Link href={`/app/${slug}/reports?from=${start}&to=${end}${locationFilter ? `&location=${locationFilter}` : ""}`} className="text-sm text-brand-700 underline">Sales report for this period</Link> : null}
        <nav className="flex items-center gap-1 text-sm" aria-label="Pay period">
          <Link href={hrefFor(prev)} className="rounded-lg p-1.5 text-stone-600 hover:bg-stone-100" aria-label="Previous period"><ChevronLeft className="h-4 w-4" /></Link>
          <span className="whitespace-nowrap px-1 font-medium tabular-nums">{dateShort(start)} – {dateShort(end)}</span>
          <Link href={hrefFor(next)} className="rounded-lg p-1.5 text-stone-600 hover:bg-stone-100" aria-label="Next period"><ChevronRight className="h-4 w-4" /></Link>
          {start === cur.start && end === cur.end ? null : <Link href={hrefFor(cur)} className="ml-1 whitespace-nowrap rounded-lg px-2 py-1 text-stone-600 hover:bg-stone-100">This period</Link>}
        </nav>
        {manage ? <details className="relative">
          <summary className="cursor-pointer select-none rounded-lg px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 marker:content-none [&::-webkit-details-marker]:hidden">Options{overtime ? " · overtime on" : ""}</summary>
          <div className="absolute right-0 z-20 mt-1 w-80 space-y-4 rounded-lg border border-stone-200 bg-white p-3 text-sm shadow-lg">
            <AutoSubmitForm>
              <input type="hidden" name="start" value={start} />
              <input type="hidden" name="end" value={end} />
              {locationFilter ? <input type="hidden" name="location" value={locationFilter} /> : null}
              <OvertimeOptions overtime={overtime} rule={business.overtimeRule} />
            </AutoSubmitForm>
            <div className="border-t border-stone-100 pt-3">
              <p className="mb-2 text-xs font-medium text-stone-600">Pay schedule</p>
              <ActionForm action={savePaySchedule}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="back" value={`/app/${slug}/payroll`} />
                <PayScheduleFields frequency={business.payFrequency} anchor={business.payAnchorDate} weekStart={business.weekStart} />
                <SubmitButton variant="secondary" size="sm" pendingText="Saving…">Save schedule</SubmitButton>
              </ActionForm>
            </div>
          </div>
        </details> : null}
        <form id="ot-rule" action={setOvertimeRule} className="hidden">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="back" value={`/app/${slug}/payroll?${qs}`} />
        </form>
        <LocationFilter locations={locations} current={locationFilter} query={`start=${start}&end=${end}&overtime=${overtime ? 1 : 0}`} allLabel="All" />
      </PageHeader>
      <p className="mb-2 text-sm text-stone-600">{formatDateLong(start)} – {formatDateLong(end)}{scheduled ? ` · ${PAY_FREQUENCY_LABEL[schedule.frequency].toLowerCase()}${scheduleSet ? "" : " (assumed: set the pay schedule under Options)"}` : " · custom range"}{locationFilter ? ` · people based at ${locations.find((l) => l.id === locationFilter)?.name}` : ""}{finalized ? <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">finalized {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(finalized.createdAt)}{finalized.overtime ? ", overtime on" : ""}</span> : null}{paid ? <span className="ml-2 rounded bg-stone-200 px-2 py-0.5 text-xs text-stone-700">paid {dateShort(finalized!.paidOn!)}{finalized!.paymentRef ? ` · ${finalized!.paymentRef}` : ""}</span> : null}</p>
      <Disclosure variant="inset" title="Custom range" hint="a one-off run between any two dates" open={!scheduled} className="mb-4 bg-white">
        <form className="flex flex-wrap items-center gap-2">
          <Input type="date" name="start" defaultValue={start} className="w-40" aria-label="Period start" />
          <span className="text-sm text-stone-500">to</span>
          <Input type="date" name="end" defaultValue={end} className="w-40" aria-label="Period end" />
          <input type="hidden" name="overtime" value={overtime ? 1 : 0} />
          {locationFilter ? <input type="hidden" name="location" value={locationFilter} /> : null}
          <Button type="submit" variant="secondary" size="sm">Run</Button>
          <span className="text-xs text-stone-500">Salary is per scheduled pay period, so a custom range pays it pro rata by days.</span>
        </form>
      </Disclosure>
      {salary.prorated && salaried ? (
        <p className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
          Salary is per scheduled pay period ({PAY_FREQUENCY_LABEL[schedule.frequency].toLowerCase()}). This range covers {salary.pieces.map((x) => `${x.coveredDays} of ${x.periodDays} days of ${dateShort(x.period.start)} – ${dateShort(x.period.end)}`).join(" and ")}, so salaried staff are paid {Math.round(salary.share * 1000) / 10}% of a period&rsquo;s salary.
        </p>
      ) : null}

      {result.rateChanges.length ? (
        <p className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
          Pay settings changed during this period: {result.rateChanges.map((c) => `${c.name} from ${formatDateLong(c.effectiveFrom)}`).join(", ")}. Commission and hourly pay follow the rate in force on each day; salary and withholding use the settings in force on {formatDateLong(end)}.
        </p>
      ) : null}

      {autoClosed.length ? (
        <div className="mb-4"><Notice>
          {autoClosed.length === 1 ? "One shift was" : `${autoClosed.length} shifts were`} closed automatically after 14 hours because nobody clocked out ({autoClosed.map((a) => `${result.employees.find((e) => e.employee.staffId === a.staffId)?.employee.name ?? "staff"} ${dateShort(a.date)}`).join(", ")}). Check the hours under <Link href={`/app/${slug}/time?from=${start}&to=${end}`} className="underline">Time clock</Link> before paying.
        </Notice></div>
      ) : null}
      {finalized && manage ? (
        <Disclosure variant="inset" title="What changed since this period was finalized" hint={drift.length ? `${drift.length} ${drift.length === 1 ? "person differs" : "people differ"}` : "nothing: live figures match"} open={drift.length > 0} className="mb-4 bg-white">
          {drift.length ? (
            <div className="text-sm">
              <p className="mb-2 text-xs text-stone-500">These figures are the ones finalized{paid ? " and paid" : ""}. Running the same period today would give:</p>
              <ul className="divide-y divide-stone-100">
                {drift.map((d) => <li key={d.staffId} className="flex items-center justify-between py-1.5"><span>{d.name}</span><span className="tabular-nums">{money(d.wasCents)} → <b>{money(d.nowCents)}</b> ({d.nowCents - d.wasCents > 0 ? "+" : "−"}{money(Math.abs(d.nowCents - d.wasCents))})</span></li>)}
              </ul>
              <p className="mt-2 text-xs text-stone-500">Late tickets, refunds and tips added later are paid in the period they happen, so most differences are already in a later period. Re-finalize only if the saved figures were wrong{paid ? " (unmark the payment first)" : ""}.</p>
            </div>
          ) : <p className="text-sm text-stone-500">Running this period again today gives the same figures as the finalized snapshot.</p>}
        </Disclosure>
      ) : null}
      {manage && unassigned.length ? (
        <div className="mb-4"><Notice>
          Unassigned: {unassigned.length === 1 ? "one line" : `${unassigned.length} lines`} worth {money(unassignedCents)} ({unassigned.filter((o) => o.kind === "tip").length} {unassigned.filter((o) => o.kind === "tip").length === 1 ? "tip" : "tips"}) {unassigned.length === 1 ? "has" : "have"} nobody credited, so nobody is paid for {unassigned.length === 1 ? "it" : "them"}: {unassigned.slice(0, 4).map((o) => `#${o.saleNumber} ${o.name} ${money(o.amountCents)}`).join("; ")}{unassigned.length > 4 ? "; …" : ""}. Open the ticket under <Link href={`/app/${slug}/sales?from=${start}&to=${end}`} className="underline">Sales</Link> and pick who did the work; the Quality Check tab of the workbook lists them all.
        </Notice></div>
      ) : null}
      {unconfigured.length ? (
        <div className="mb-4"><Notice>{unconfigured.map((e) => e.employee.name).join(", ")} earned service revenue but {unconfigured.length > 1 ? "have" : "has"} no commission rate. Set it under Staff → Pay.</Notice></div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[["Total payroll", totals.total], ["Tips passed through", totals.tips], ["Service revenue generated", totals.rev]].map(([l, v]) => (
          <Card key={String(l)} className="p-4"><p className="text-xs uppercase tracking-wide text-stone-500">{l}</p><p className="text-xl font-semibold">{money(Number(v))}</p></Card>
        ))}
      </div>

      <Card className="mb-6 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-2">
          <h2 className="text-sm font-semibold text-stone-600">Summary</h2>
          {active.length ? <div className="flex gap-2">
            <LinkButton href={`/app/${slug}/payroll/export?${qs}`} size="sm"><Download className="h-4 w-4" /> Workbook (.xlsx)</LinkButton>
            {manage ? <LinkButton href={`/app/${slug}/payroll/export?${qs}&kind=w2`} size="sm"><Download className="h-4 w-4" /> W-2 summary</LinkButton> : null}
            {manage ? <LinkButton href={`/app/${slug}/payroll/export?${qs}&kind=csv`} size="sm" variant="ghost"><Download className="h-4 w-4" /> Summary CSV</LinkButton> : null}
            {locationFilter || !manage || paid ? null : <form action={finalize}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="start" value={start} />
              <input type="hidden" name="end" value={end} />
              {overtime ? <input type="hidden" name="overtime" value="on" /> : null}
              <ConfirmSubmit title={finalized ? "Re-finalize this period?" : "Finalize this pay period?"} body={finalized ? "This replaces the saved figures with today's. What changed, person by person, is kept in the activity log." : "These figures are saved as the period's record: the page and the workbook show them from now on. Hours, adjustments and pay rates inside the period are locked; refunds and late tickets after this are paid in the period they happen."} confirmLabel={finalized ? "Re-finalize" : "Finalize"} variant={finalized ? "secondary" : "primary"}>{finalized ? "Re-finalize" : "Finalize period"}</ConfirmSubmit>
            </form>}
          </div> : null}
        </div>
        {active.length === 0 ? <div className="p-4"><Empty title="No pay activity in this period" body="Closed sales, hours and adjustments drive payroll." /></div> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>{["Employee", "Position", "Pay type", "Rate", "Commission", "Wage", "Cash tip", "Card tip", "Card-tip fee", "Total", "Svc revenue", "Svc profit"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {active.map((e) => {
                const emp = e.employee;
                const commission = e.mainCommissionCents + e.productCommissionCents + (e.feeShareCents ?? 0);
                const wage = e.wageCents + (emp.payType === "commission" ? 0 : e.adjustmentsCents);
                return (
                  <tr key={emp.staffId}>
                    <td className="px-3 py-2 font-medium"><a href={`#emp-${emp.staffId}`} className="hover:underline">{emp.name}</a></td>
                    <td className="px-3 py-2">{emp.position ?? ""}</td>
                    <td className="px-3 py-2">{emp.payType}</td>
                    <td className="px-3 py-2">{rateLabel(emp)}</td>
                    <td className="px-3 py-2 text-right">{money(commission)}</td>
                    <td className="px-3 py-2 text-right">{money(wage)}</td>
                    <td className="px-3 py-2 text-right">{money(e.cashTipsCents)}</td>
                    <td className="px-3 py-2 text-right">{money(e.cardTipsCents)}</td>
                    <td className="px-3 py-2 text-right text-red-700">{e.ccTipFeeCents ? `−${money(e.ccTipFeeCents)}` : money(0)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{money(e.totalCents)}</td>
                    <td className="px-3 py-2 text-right">{money(e.serviceRevenueCents)}</td>
                    <td className="px-3 py-2 text-right">{money(e.serviceProfitCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {active.map((e) => {
            const emp = e.employee;
            return (
              <Card key={emp.staffId} id={`emp-${emp.staffId}`} className="p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="font-semibold">{emp.name} <span className="text-xs font-normal text-stone-500">{emp.position} · {emp.payType} · {rateLabel(emp)}</span></h3>
                  <span className="text-lg font-semibold">{money(e.totalCents)}</span>
                </div>
                {emp.payType === "commission" ? (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                    <dt className="text-stone-500">Main service revenue</dt><dd className="text-right sm:col-span-2">{money(e.mainRevenueCents)}</dd>
                    <dt className="text-stone-500">Main Services ({(emp.mainCommissionBps / 100).toFixed(0)}%)</dt><dd className="text-right sm:col-span-2">{money(e.mainCommissionCents)}</dd>
                    {e.wageCents ? <><dt className="text-stone-500">Hourly base ({(e.totalMinutes / 60).toFixed(2)} h × ${(emp.hourlyRateCents / 100).toFixed(2)}{e.overtimeApplied ? `, ${otText(e)}` : ""})</dt><dd className="text-right sm:col-span-2">{money(e.wageCents)}</dd></> : null}
                    <dt className="text-stone-500">Product/Package Sale ({(emp.productCommissionBps / 100).toFixed(0)}%) on {money(e.productSalesCents)}</dt><dd className="text-right sm:col-span-2">{money(e.productCommissionCents)}</dd>
                    {e.feeShareCents ? <><dt className="text-stone-500">No-show and late fees ({business.feeShareBps / 100}% share)</dt><dd className="text-right sm:col-span-2">{money(e.feeShareCents)}</dd></> : null}
                    <dt className="text-stone-500">Cash tips</dt><dd className="text-right sm:col-span-2">{money(e.cashTipsCents)}</dd>
                    <dt className="text-stone-500">Card tips</dt><dd className="text-right sm:col-span-2">{money(e.cardTipsCents)}</dd>
                    <dt className="text-stone-500">Fees on CC tip ({(emp.ccTipFeeBps / 100).toFixed(1)}%)</dt><dd className="text-right text-red-700 sm:col-span-2">{e.ccTipFeeCents ? `−${money(e.ccTipFeeCents)}` : money(0)}</dd>
                    {e.adjustments.map((a, i) => <><dt key={`l${i}`} className="text-stone-500">{a.label}</dt><dd key={`v${i}`} className="text-right sm:col-span-2">{money(a.amountCents)}</dd></>)}
                    <dt className="font-semibold">Total 1099</dt><dd className="text-right font-semibold sm:col-span-2">{money(e.totalCents)}</dd>
                  </dl>
                ) : (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                    {emp.payType === "hourly" ? <><dt className="text-stone-500">Hours{e.overtimeApplied ? ` (${otText(e)})` : ""}</dt><dd className="text-right sm:col-span-2">{(e.totalMinutes / 60).toFixed(2)}{e.totalMinutes === 0 ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">no punches</span> : null}</dd></> : null}
                    <dt className="text-stone-500">{emp.payType === "hourly" ? "Pay" : "Salary"}</dt><dd className="text-right sm:col-span-2">{money(e.wageCents)}</dd>
                    {emp.mainCommissionBps > 0 ? <><dt className="text-stone-500">Service commission ({(emp.mainCommissionBps / 100).toFixed(emp.mainCommissionBps % 100 ? 1 : 0)}%) on {money(e.mainRevenueCents)}</dt><dd className="text-right sm:col-span-2">{money(e.mainCommissionCents)}</dd></> : null}
                    {e.cashTipsCents + e.cardTipsCents ? <><dt className="text-stone-500">Tips (cash {money(e.cashTipsCents)} / card {money(e.cardTipsCents)}, fee −{money(e.ccTipFeeCents)})</dt><dd className="text-right sm:col-span-2">{money(e.cashTipsCents + e.cardTipsCents - e.ccTipFeeCents)}</dd></> : null}
                    {e.productSalesCents ? <><dt className="text-stone-500">Product/Package ({(emp.productCommissionBps / 100).toFixed(0)}%)</dt><dd className="text-right sm:col-span-2">{money(e.productCommissionCents)}</dd></> : null}
                    {e.feeShareCents ? <><dt className="text-stone-500">No-show and late fees ({business.feeShareBps / 100}% share)</dt><dd className="text-right sm:col-span-2">{money(e.feeShareCents)}</dd></> : null}
                    {e.adjustments.map((a, i) => <><dt key={`l${i}`} className="text-stone-500">{a.label}</dt><dd key={`v${i}`} className="text-right sm:col-span-2">{money(a.amountCents)}</dd></>)}
                    <dt className="text-stone-500">Tax deductions</dt><dd className="text-right sm:col-span-2">{e.taxCents ? `−${money(e.taxCents)}` : "$0.00 (accountant enters)"}</dd>
                    <dt className="font-semibold">Total check</dt><dd className="text-right font-semibold sm:col-span-2">{money(e.totalCents)}</dd>
                  </dl>
                )}
                {e.mainRows.length + e.miscRows.length > 0 ? (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-brand-700">{e.mainRows.length + e.miscRows.length} transactions{[...e.mainRows, ...e.miscRows].some((l) => l.amtPaidCents < 0) ? ` · includes refunds` : ""}</summary>
                    <div className="overflow-x-auto"><table className="mt-2 w-full text-xs">
                      <thead className="text-left text-stone-500"><tr><th className="py-1 pr-2">Date</th><th className="py-1 pr-2">Customer</th><th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Section</th><th className="py-1 pr-2 text-right">Cash</th><th className="py-1 pr-2 text-right">Cash tip</th><th className="py-1 pr-2 text-right">Card</th><th className="py-1 pr-2 text-right">CC tip</th><th className="py-1 pr-2 text-right">Disc</th><th className="py-1 text-right">Amt paid</th></tr></thead>
                      <tbody className="divide-y divide-stone-100">
                        {[...e.miscRows, ...e.mainRows].map((l, i) => (
                          <tr key={i} className={l.amtPaidCents < 0 ? "text-red-700" : ""}>
                            <td className="py-1 pr-2">{dateShort(l.date)}</td><td className="py-1 pr-2">{l.customer}</td><td className="py-1 pr-2">{l.name}</td><td className="py-1 pr-2">{l.kind === "service" ? "main" : "misc"}</td>
                            <td className="py-1 pr-2 text-right">{money(l.cashCents)}</td><td className="py-1 pr-2 text-right">{money(l.cashTipCents)}</td><td className="py-1 pr-2 text-right">{money(l.cardCents)}</td><td className="py-1 pr-2 text-right">{money(l.cardTipCents)}</td><td className="py-1 pr-2 text-right">{money(l.discountCents)}</td><td className="py-1 text-right">{money(l.amtPaidCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  </details>
                ) : null}
              </Card>
            );
          })}
        </div>

        <div className="space-y-6">
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium">Adjustments</h2>
              {manage && !finalized ? <LinkButton href={`/app/${slug}/payroll/adjustments/new?start=${start}&end=${end}`} size="sm"><Plus className="h-4 w-4" /> Add</LinkButton> : null}
            </div>
            <p className="mb-2 text-xs text-stone-500">One-off lines for this period: training pay, transfers, corrections.{finalized ? " This period is finalized; put a correction in the current period." : ""}</p>
            {result.adjustmentRows.length === 0 ? <p className="text-sm text-stone-500">None for this period.</p> : (
              <ul className="divide-y divide-stone-100 text-sm">
                {result.adjustmentRows.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-1.5">
                    <span>{result.employees.find((e) => e.employee.staffId === a.staffId)?.employee.name} · {a.label} · {money(a.amountCents)}</span>
                    {manage ? <form action={deleteAdjustment}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={a.id} /><ConfirmSubmit title="Remove this adjustment?" confirmLabel="Remove" variant="ghost" className="text-stone-500 hover:text-red-600">Remove</ConfirmSubmit></form> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {manage && finalized ? <Card className="p-4">
            <h2 className="mb-1 font-medium">{paid ? "Paid" : "Payment"}</h2>
            {paid ? (
              <div className="text-sm">
                <p>Checks went out {dateShort(finalized.paidOn!)}{finalized.paymentRef ? <> · <span className="text-stone-600">{finalized.paymentRef}</span></> : null}.</p>
                <form action={unmarkPaid} className="mt-2">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="start" value={start} />
                  <input type="hidden" name="end" value={end} />
                  <ConfirmSubmit title="Unmark this period as paid?" body="Only do this to correct the record. Re-finalizing becomes possible again." confirmLabel="Unmark" variant="ghost" className="text-stone-500 hover:text-red-600">Unmark</ConfirmSubmit>
                </form>
              </div>
            ) : (
              <form action={markPaid} className="space-y-2 text-sm">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="start" value={start} />
                <input type="hidden" name="end" value={end} />
                <p className="text-xs text-stone-500">Record the day the checks went out and a check number or batch reference. The period can&rsquo;t be re-finalized while it is marked paid.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="date" name="paidOn" defaultValue={today} aria-label="Paid on" required />
                  <Input name="paymentRef" placeholder="Check # or batch" aria-label="Check or batch reference" maxLength={80} />
                </div>
                <Button type="submit" variant="secondary" size="sm">Mark as paid</Button>
              </form>
            )}
          </Card> : null}
          {manage ? <Card className="p-4">
            <h2 className="mb-1 font-medium">Finalized periods</h2>
            {runs.length === 0 ? <p className="text-sm text-stone-500">None yet.</p> : (
              <ul className="divide-y divide-stone-100 text-sm">
                {runs.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-1.5"><Link href={`?start=${r.periodStart}&end=${r.periodEnd}&overtime=${r.overtime ? 1 : 0}`} className="text-brand-700 underline">{dateShort(r.periodStart)} – {dateShort(r.periodEnd)}</Link>{r.paidOn ? <span className="text-xs text-stone-500">paid {dateShort(r.paidOn)}</span> : null}</li>
                ))}
              </ul>
            )}
          </Card> : null}
          <Card className="p-4 text-xs text-stone-500">
            <p>Commission is figured on service money (amount paid minus tips{business.discountAbsorb === "provider" ? ", net of discount" : business.discountAbsorb === "house" ? "; the house absorbs discounts, so full price counts" : "; discounts are split half and half with the house"}), credited to the appointment date.{business.feeShareBps ? ` The provider gets ${business.feeShareBps / 100}% of no-show and late fees.` : ""} Products and packages earn the product rate on the tax-inclusive amount; memberships earn nothing. Card tips carry the card-tip fee; cash tips never do. Tax withholding for W-2 staff is left at $0 unless set on the staff member. A refund comes off pay on the day it is made ("Refund ·" rows), so one made after a period was paid reduces the next period. <Link href={`/app/${slug}/staff`} className="underline">Set pay rules under Staff.</Link></p>
          </Card>
        </div>
      </div>
    </>
  );
}
