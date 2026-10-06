import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Button, Card, Input, PageHeader } from "@/components/ui";
import { saveSchedule, saveStaffServices } from "../actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function StaffDetailPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "staff.manage");
  const data = await withTenant(business.id, async (tx) => {
    const person = await tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) });
    if (!person) return null;
    const [schedule, services, mapped] = await Promise.all([
      tx.select().from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId)),
      tx.select().from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)),
      tx.select({ serviceId: schema.staffServices.serviceId }).from(schema.staffServices).where(eq(schema.staffServices.staffId, staffId)),
    ]);
    return { person, schedule, services, mapped: new Set(mapped.map((m) => m.serviceId)) };
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
      </div>
    </>
  );
}
