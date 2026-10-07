import { and, asc, eq, gte } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { formatDateLong } from "@/lib/utils";
import { Button, Card, Input, Select, Empty } from "@/components/ui";
import { addOverride, deleteOverride } from "../../actions";

export default async function StaffTimeOffPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "staff.manage");
  const today = new Date().toISOString().slice(0, 10);
  const overrides = await withTenant(business.id, (tx) =>
    tx.select().from(schema.staffScheduleOverrides).where(and(eq(schema.staffScheduleOverrides.staffId, staffId), gte(schema.staffScheduleOverrides.date, today))).orderBy(asc(schema.staffScheduleOverrides.date)),
  );
  const hhmm = (t: string) => t.slice(0, 5);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Upcoming days off &amp; custom hours</h2>
        {overrides.length === 0 ? <div className="p-4"><Empty title="Nothing scheduled" body="Add a day off or custom hours on the right." /></div> : (
          <ul className="divide-y divide-stone-100 text-sm">
            {overrides.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-2">
                <span className="w-56 font-medium">{formatDateLong(o.date)}</span>
                <span className="flex-1 text-stone-600">{o.isOff ? "Day off" : `${hhmm(o.startTime!)} – ${hhmm(o.endTime!)}`}{o.note ? ` · ${o.note}` : ""}</span>
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
      <Card className="p-4">
        <h2 className="mb-3 font-medium">Add</h2>
        <form action={addOverride} className="space-y-2">
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
          <div className="grid grid-cols-2 gap-2">
            <div><label className="mb-1 block text-xs font-medium text-stone-600">Start</label><Input type="time" name="start" className="px-2" /></div>
            <div><label className="mb-1 block text-xs font-medium text-stone-600">End</label><Input type="time" name="end" className="px-2" /></div>
          </div>
          <div><label className="mb-1 block text-xs font-medium text-stone-600">Note</label><Input name="note" placeholder="Vacation, training…" /></div>
          <Button type="submit" variant="secondary">Add</Button>
        </form>
      </Card>
    </div>
  );
}
