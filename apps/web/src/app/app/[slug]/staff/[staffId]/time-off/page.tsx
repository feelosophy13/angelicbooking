import { and, asc, eq, gte } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { PermissionError, requireBusiness } from "@/lib/tenant";
import { canEditOwnStaff } from "@/lib/visibility";
import { dateLong } from "@/lib/format";
import { Card, Input, Empty } from "@/components/ui";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
import { Disclosure } from "@/components/disclosure";
import { addOverride, deleteOverride } from "../../actions";
import { OverrideFields } from "./override-fields";

type Override = typeof schema.staffScheduleOverrides.$inferSelect;
interface Group { from: string; to: string; ids: string[]; isOff: boolean; startTime: string | null; endTime: string | null; note: string | null }

const nextDay = (d: string) => new Date(new Date(d + "T00:00:00Z").getTime() + 86_400_000).toISOString().slice(0, 10);

/** Consecutive dates with the same entry collapse into one line ("Oct 12 – Oct 18"). */
function groupConsecutive(rows: Override[]): Group[] {
  const out: Group[] = [];
  for (const o of rows) {
    const g = out[out.length - 1];
    if (g && nextDay(g.to) === o.date && g.isOff === o.isOff && g.startTime === o.startTime && g.endTime === o.endTime && (g.note ?? "") === (o.note ?? "")) {
      g.to = o.date;
      g.ids.push(o.id);
    } else out.push({ from: o.date, to: o.date, ids: [o.id], isOff: o.isOff, startTime: o.startTime, endTime: o.endTime, note: o.note });
  }
  return out;
}

const dateMid = (d: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
const year = (d: string) => d.slice(0, 4);
function describeRange(g: Group): string {
  if (g.from === g.to) return dateLong(g.from);
  return year(g.from) === year(g.to) ? `${dateMid(g.from)} – ${dateMid(g.to)}, ${year(g.to)}` : `${dateMid(g.from)}, ${year(g.from)} – ${dateMid(g.to)}, ${year(g.to)}`;
}

export default async function StaffTimeOffPage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business, permissions, staffId: myStaffId } = await requireBusiness(slug);
  if (!canEditOwnStaff(permissions, myStaffId ?? null, staffId, "hours")) throw new PermissionError(); // their own, or "Manage staff"
  const today = instantToISODate(new Date(), business.timezone);
  const overrides = await withTenant(business.id, (tx) =>
    tx.select().from(schema.staffScheduleOverrides).where(and(eq(schema.staffScheduleOverrides.staffId, staffId), gte(schema.staffScheduleOverrides.date, today))).orderBy(asc(schema.staffScheduleOverrides.date)),
  );
  const groups = groupConsecutive(overrides);
  const hhmm = (t: string) => t.slice(0, 5);
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Card>
        <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Upcoming time off &amp; custom hours</h2>
        {groups.length === 0 ? <div className="p-4"><Empty title="Nothing scheduled" body="Add a day off, a vacation or custom hours on the right." /></div> : (
          <ul className="divide-y divide-stone-100 text-sm">
            {groups.map((g) => {
              const days = g.ids.length;
              return (
                <li key={g.ids[0]} className="flex items-center gap-3 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{describeRange(g)}</p>
                    <p className="text-xs text-stone-500">
                      {g.isOff ? (days > 1 ? `${days} days off` : "Day off") : `${hhmm(g.startTime!)} – ${hhmm(g.endTime!)}${days > 1 ? ` · ${days} days` : ""}`}
                      {g.note ? ` · ${g.note}` : ""}
                    </p>
                  </div>
                  <form action={deleteOverride}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="staffId" value={staffId} />
                    {g.ids.map((id) => <input key={id} type="hidden" name="overrideId" value={id} />)}
                    <ConfirmSubmit title={days > 1 ? "Remove these days?" : "Remove this entry?"} body={`${describeRange(g)} goes back to the regular weekly hours.`} confirmLabel="Remove" variant="ghost">Remove</ConfirmSubmit>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Disclosure title="Add time off or custom hours" defaultOpen={groups.length === 0} className="self-start">
        <ActionForm action={addOverride}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="staffId" value={staffId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="First day" name="date" required><Input type="date" name="date" required className="px-2" /></Field>
            <Field label="Last day" name="to" hint="Blank for one day"><Input type="date" name="to" className="px-2" /></Field>
          </div>
          <OverrideFields />
          <Field label="Note" name="note"><Input name="note" placeholder="Vacation, training…" /></Field>
          <SubmitButton variant="secondary" pendingText="Adding…">Add</SubmitButton>
        </ActionForm>
      </Disclosure>
    </div>
  );
}
