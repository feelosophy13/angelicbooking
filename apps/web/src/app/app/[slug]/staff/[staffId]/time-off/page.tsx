import { and, asc, eq, gte } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { dateLong } from "@/lib/format";
import { Card, Input, Select, Empty } from "@/components/ui";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
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
                <span className="w-60 font-medium">{dateLong(o.date)}</span>
                <span className="flex-1 text-stone-600">{o.isOff ? "Day off" : `${hhmm(o.startTime!)} – ${hhmm(o.endTime!)}`}{o.note ? ` · ${o.note}` : ""}</span>
                <form action={deleteOverride}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="staffId" value={staffId} />
                  <input type="hidden" name="overrideId" value={o.id} />
                  <ConfirmSubmit title="Remove this entry?" body={`${dateLong(o.date)} goes back to the regular weekly hours.`} confirmLabel="Remove" variant="ghost">Remove</ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 font-medium">Add</h2>
        <ActionForm action={addOverride}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="staffId" value={staffId} />
          <Field label="Date" name="date" required><Input type="date" name="date" required /></Field>
          <Field label="Type" name="kind">
            <Select name="kind" defaultValue="off">
              <option value="off">Day off</option>
              <option value="hours">Custom hours</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start" name="start" hint="Custom hours only"><Input type="time" name="start" className="px-2" /></Field>
            <Field label="End" name="end"><Input type="time" name="end" className="px-2" /></Field>
          </div>
          <Field label="Note" name="note"><Input name="note" placeholder="Vacation, training…" /></Field>
          <SubmitButton variant="secondary" pendingText="Adding…">Add</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
