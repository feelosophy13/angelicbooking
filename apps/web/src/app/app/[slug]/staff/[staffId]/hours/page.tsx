import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card, Input, Select, Checkbox } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { saveSchedule } from "../../actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function StaffHoursPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "staff.manage");
  const { schedule, person, locations } = await withTenant(business.id, async (tx) => ({
    schedule: await tx.select().from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId)),
    person: await tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId), columns: { locationId: true } }),
    locations: await tx.select({ id: schema.locations.id, name: schema.locations.name, isDefault: schema.locations.isDefault }).from(schema.locations).orderBy(asc(schema.locations.name)),
  }));
  const multi = locations.length > 1;
  const fallbackLoc = person?.locationId ?? locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? "";
  const byDay = new Map(schedule.map((r) => [r.weekday, r]));
  const hhmm = (t: string) => t.slice(0, 5);
  return (
    <Card className="p-4">
      <p className="mb-3 text-xs text-stone-500">
        Regular weekly hours. Use Time off for single-day changes.
        {multi ? " Pick where they work each day: the calendar, online booking and reports follow it." : ""}
      </p>
      <form action={saveSchedule} className="space-y-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="staffId" value={staffId} />
        {DAYS.map((name, weekday) => {
          const row = byDay.get(weekday);
          return (
            <div key={weekday} className={`grid items-center gap-3 py-1 text-sm ${multi ? "grid-cols-[8.5rem_9.5rem_max-content_9.5rem_minmax(14rem,22rem)]" : "grid-cols-[8.5rem_9.5rem_max-content_9.5rem]"}`}>
              <Checkbox name={`on_${weekday}`} defaultChecked={!!row} label={name} className="!items-center [&>input]:mt-0" />
              <Input name={`start_${weekday}`} type="time" defaultValue={row ? hhmm(row.startTime) : "09:00"} className="w-full" aria-label={`${name} start`} />
              <span className="text-stone-400">to</span>
              <Input name={`end_${weekday}`} type="time" defaultValue={row ? hhmm(row.endTime) : "17:00"} className="w-full" aria-label={`${name} end`} />
              {multi ? (
                <Select name={`loc_${weekday}`} defaultValue={row?.locationId ?? fallbackLoc} aria-label={`${name} location`}>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              ) : null}
            </div>
          );
        })}
        <SubmitButton className="mt-2" pendingText="Saving…">Save hours</SubmitButton>
      </form>
    </Card>
  );
}
