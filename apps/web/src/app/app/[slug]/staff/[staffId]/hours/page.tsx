import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Button, Card, Input } from "@/components/ui";
import { saveSchedule } from "../../actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function StaffHoursPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "staff.manage");
  const schedule = await withTenant(business.id, (tx) => tx.select().from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId)));
  const byDay = new Map(schedule.map((r) => [r.weekday, r]));
  const hhmm = (t: string) => t.slice(0, 5);
  return (
    <Card className="max-w-lg p-4">
      <p className="mb-3 text-xs text-stone-500">Regular weekly hours. Use Time off for single-day changes.</p>
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
  );
}
