import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { saveSchedule } from "../../actions";
import { WeeklyHoursEditor, type DayHours } from "./editor";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function StaffHoursPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "staff.manage");
  const { schedule, person, locations } = await withTenant(business.id, async (tx) => ({
    schedule: await tx.select().from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId)).orderBy(asc(schema.staffSchedules.weekday), asc(schema.staffSchedules.startTime)),
    person: await tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId), columns: { locationId: true } }),
    locations: await tx.select({ id: schema.locations.id, name: schema.locations.name, isDefault: schema.locations.isDefault }).from(schema.locations).orderBy(asc(schema.locations.name)),
  }));
  const multi = locations.length > 1;
  const fallbackLoc = person?.locationId ?? locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? "";
  const hhmm = (t: string) => t.slice(0, 5);
  const initial: DayHours[] = DAYS.map((name, weekday) => {
    const rows = schedule.filter((r) => r.weekday === weekday);
    return { weekday, name, blocks: rows.map((r) => ({ start: hhmm(r.startTime), end: hhmm(r.endTime) })), locationId: rows[0]?.locationId ?? fallbackLoc };
  });
  return (
    <Card className="w-fit max-w-full p-4">
      <p className="mb-3 text-xs text-stone-500">
        Regular weekly hours. Press + to add a lunch break or a split shift. Use Time off for days or weeks that differ.
        {multi ? " Pick where they work each day: the calendar, online booking and reports follow it." : ""}
      </p>
      <form action={saveSchedule} className="space-y-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="staffId" value={staffId} />
        <WeeklyHoursEditor initial={initial} locations={locations.map((l) => ({ id: l.id, name: l.name }))} />
        <SubmitButton className="mt-2" pendingText="Saving…">Save hours</SubmitButton>
      </form>
    </Card>
  );
}
