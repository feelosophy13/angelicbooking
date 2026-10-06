import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Button, Card, Input, PageHeader } from "@/components/ui";
import { addOverride, deleteOverride, savePay, saveSchedule, saveStaffLocation, saveStaffServices } from "../actions";
import { can } from "@angelic/core";
import { formatDateLong } from "@/lib/utils";
import { gte } from "drizzle-orm";
import { Select } from "@/components/ui";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function StaffDetailPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business, role } = await requireAction(slug, "staff.manage");
  const data = await withTenant(business.id, async (tx) => {
    const person = await tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) });
    if (!person) return null;
    const today = new Date().toISOString().slice(0, 10);
    const locations = await tx.select().from(schema.locations).orderBy(asc(schema.locations.name));
    const [schedule, services, mapped, overrides] = await Promise.all([
      tx.select().from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId)),
      tx.select().from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)),
      tx.select({ serviceId: schema.staffServices.serviceId }).from(schema.staffServices).where(eq(schema.staffServices.staffId, staffId)),
      tx
        .select()
        .from(schema.staffScheduleOverrides)
        .where(and(eq(schema.staffScheduleOverrides.staffId, staffId), gte(schema.staffScheduleOverrides.date, today)))
        .orderBy(asc(schema.staffScheduleOverrides.date)),
    ]);
    return { person, schedule, services, mapped: new Set(mapped.map((m) => m.serviceId)), overrides, locations };
  });
  if (!data) notFound();
  const byDay = new Map(data.schedule.map((r) => [r.weekday, r]));
  const hhmm = (t: string) => t.slice(0, 5);

  return (
    <>
      <PageHeader title={data.person.displayName} />
      <div className="grid gap-6 lg:grid-cols-[440px_1fr]">
        <Card className="p-4">
          <h2 className="mb-3 font-medium">Weekly hours</h2>
          <form action={saveSchedule} className="space-y-2">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="staffId" value={staffId} />
            {DAYS.map((name, weekday) => {
              const row = byDay.get(weekday);
              return (
                <div key={weekday} className="grid grid-cols-[6rem_7rem_auto_7rem] items-center gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name={`on_${weekday}`} defaultChecked={!!row} className="h-4 w-4 accent-brand-600" />
                    {name}
                  </label>
                  <Input name={`start_${weekday}`} type="time" defaultValue={row ? hhmm(row.startTime) : "09:00"} className="w-28 px-2" />
                  <span className="text-stone-400">to</span>
                  <Input name={`end_${weekday}`} type="time" defaultValue={row ? hhmm(row.endTime) : "17:00"} className="w-28 px-2" />
                </div>
              );
            })}
            <Button type="submit" className="mt-2">Save hours</Button>
          </form>
        </Card>
        {data.locations.length > 1 ? (
          <Card className="p-4 lg:col-span-2">
            <form action={saveStaffLocation} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="staffId" value={staffId} />
              <div className="min-w-56"><label className="mb-1 block text-xs font-medium text-stone-600">Primary location</label>
                <Select name="locationId" defaultValue={data.person.locationId ?? ""}>
                  <option value="">Any / unassigned</option>
                  {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </div>
              <Button type="submit" variant="secondary">Save location</Button>
            </form>
          </Card>
        ) : null}

        <Card className="p-4">
          <h2 className="mb-1 font-medium">Services performed</h2>
          <p className="mb-3 text-xs text-stone-500">If none are selected, this person can be booked for every service.</p>
          <form action={saveStaffServices} className="space-y-2">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="staffId" value={staffId} />
            {data.services.length === 0 ? <p className="text-sm text-stone-500">No services yet.</p> : null}
            {data.services.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="serviceIds" value={s.id} defaultChecked={data.mapped.has(s.id)} className="h-4 w-4 accent-brand-600" />
                {s.name} <span className="text-stone-400">· {s.durationMin} min</span>
              </label>
            ))}
            <Button type="submit" className="mt-2" variant="secondary">Save services</Button>
          </form>
        </Card>

        {can(role, "members.manage") ? (
          <Card className="p-4 lg:col-span-2">
            <h2 className="mb-1 font-medium">Pay</h2>
            <p className="mb-3 text-xs text-stone-500">Drives the Payroll page. Commission providers are paid on service revenue; hourly and salaried staff keep tips from procedures they perform and earn the product rate on their sales.</p>
            <form action={savePay} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="staffId" value={staffId} />
              <div><label className="mb-1 block text-xs font-medium text-stone-600">Position</label><Input name="position" defaultValue={data.person.position ?? ""} placeholder="Lash Artist" /></div>
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-600">Pay type</label>
                <Select name="payType" defaultValue={data.person.payType}>
                  <option value="commission">Commission (1099)</option>
                  <option value="hourly">Hourly (W-2)</option>
                  <option value="salary">Salary (W-2)</option>
                </Select>
              </div>
              <div><label className="mb-1 block text-xs font-medium text-stone-600">Main services %</label><Input name="mainCommissionPct" type="number" step="0.5" min={0} max={100} defaultValue={(data.person.mainCommissionBps / 100).toString()} /></div>
              <div><label className="mb-1 block text-xs font-medium text-stone-600">Product/package %</label><Input name="productCommissionPct" type="number" step="0.5" min={0} max={100} defaultValue={(data.person.productCommissionBps / 100).toString()} /></div>
              <div><label className="mb-1 block text-xs font-medium text-stone-600">Fee on card tips %</label><Input name="ccTipFeePct" type="number" step="0.1" min={0} max={100} defaultValue={(data.person.ccTipFeeBps / 100).toString()} /></div>
              <div><label className="mb-1 block text-xs font-medium text-stone-600">Hourly rate ($)</label><Input name="hourlyRate" inputMode="decimal" defaultValue={data.person.hourlyRateCents ? (data.person.hourlyRateCents / 100).toFixed(2) : ""} /></div>
              <div><label className="mb-1 block text-xs font-medium text-stone-600">Salary per period ($)</label><Input name="salaryPerPeriod" inputMode="decimal" defaultValue={data.person.salaryPerPeriodCents ? (data.person.salaryPerPeriodCents / 100).toFixed(2) : ""} /></div>
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-600">Overtime</label>
                <Select name="overtimeOverride" defaultValue={data.person.overtimeOverride == null ? "default" : data.person.overtimeOverride ? "yes" : "no"}>
                  <option value="default">Follow payroll run</option>
                  <option value="yes">Always 1.5× over 40h</option>
                  <option value="no">Never (straight time)</option>
                </Select>
              </div>
              <div><label className="mb-1 block text-xs font-medium text-stone-600">Tax withholding ($/period)</label><Input name="taxDeductionAmount" inputMode="decimal" defaultValue={data.person.taxDeductionCents != null ? (data.person.taxDeductionCents / 100).toFixed(2) : ""} placeholder="blank = accountant" /></div>
              <div><label className="mb-1 block text-xs font-medium text-stone-600">or withholding %</label><Input name="taxDeductionPct" type="number" step="0.1" min={0} max={60} defaultValue={data.person.taxDeductionBps != null ? (data.person.taxDeductionBps / 100).toString() : ""} /></div>
              <div className="sm:col-span-3 lg:col-span-5"><Button type="submit">Save pay settings</Button></div>
            </form>
          </Card>
        ) : null}

        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-1 font-medium">Days off &amp; custom hours</h2>
          <p className="mb-3 text-xs text-stone-500">Overrides the weekly hours for a single date.</p>
          <form action={addOverride} className="mb-4 grid grid-cols-2 items-end gap-2 md:grid-cols-[10rem_10rem_7rem_7rem_1fr_auto]">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="staffId" value={staffId} />
            <div><label className="mb-1 block text-xs font-medium text-stone-600">Date</label><Input type="date" name="date" required /></div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">Type</label>
              <Select name="kind" defaultValue="off">
                <option value="off">Day off</option>
                <option value="hours">Custom hours</option>
              </Select>
            </div>
            <div><label className="mb-1 block text-xs font-medium text-stone-600">Start</label><Input type="time" name="start" className="px-2" /></div>
            <div><label className="mb-1 block text-xs font-medium text-stone-600">End</label><Input type="time" name="end" className="px-2" /></div>
            <div><label className="mb-1 block text-xs font-medium text-stone-600">Note</label><Input name="note" placeholder="Vacation, training…" /></div>
            <Button type="submit" variant="secondary">Add</Button>
          </form>
          {data.overrides.length === 0 ? (
            <p className="text-sm text-stone-500">No upcoming overrides.</p>
          ) : (
            <ul className="divide-y divide-stone-200 text-sm">
              {data.overrides.map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-2">
                  <span className="w-56 font-medium">{formatDateLong(o.date)}</span>
                  <span className="flex-1 text-stone-600">
                    {o.isOff ? "Day off" : `${hhmm(o.startTime!)} – ${hhmm(o.endTime!)}`}
                    {o.note ? ` · ${o.note}` : ""}
                  </span>
                  <form action={deleteOverride}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="staffId" value={staffId} />
                    <input type="hidden" name="overrideId" value={o.id} />
                    <Button size="sm" variant="ghost" type="submit">Remove</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
