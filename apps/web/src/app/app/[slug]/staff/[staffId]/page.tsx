import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { resetCalendarToken, updateStaffProfile } from "../actions";
import { ConfirmSubmit } from "@/components/form";
import { appUrl } from "@/lib/stripe";

export default async function StaffProfilePage({ params }: { params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business } = await requireAction(slug, "staff.manage");
  const data = await withTenant(business.id, async (tx) => {
    const person = await tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) });
    const locations = await tx.select().from(schema.locations).orderBy(asc(schema.locations.name));
    return person ? { person, locations } : null;
  });
  if (!data) notFound();
  const { person, locations } = data;
  const feedUrl = appUrl(`/api/calendar/${person.calendarToken}.ics`);
  const webcal = feedUrl.replace(/^https?:\/\//, "webcal://");
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,32rem)_minmax(0,22rem)]">
    <Card className="p-5">
      <ActionForm action={updateStaffProfile}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="staffId" value={staffId} />
        <Field label="Name" name="displayName" required><Input name="displayName" defaultValue={person.displayName} required /></Field>
        <Field label="Email" name="email"><Input name="email" type="email" defaultValue={person.email ?? ""} /></Field>
        <Field label="Phone" name="phone"><Input name="phone" defaultValue={person.phone ?? ""} /></Field>
        <Field label="Calendar colour" name="color"><Input name="color" type="color" defaultValue={person.color} className="h-10 w-24 p-1" /></Field>
        {locations.length > 1 ? (
          <Field label="Primary location" name="locationId">
            <Select name="locationId" defaultValue={person.locationId ?? ""}>
              <option value="">Any / unassigned</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="takesAppointments" defaultChecked={person.takesAppointments} className="h-4 w-4 accent-brand-600" /> Takes appointments <span className="text-xs text-stone-500">(has a calendar column; untick for front desk, managers or an owner login that doesn't see clients)</span></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="bookableOnline" defaultChecked={person.bookableOnline} className="h-4 w-4 accent-brand-600" /> Bookable online</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={person.active} className="h-4 w-4 accent-brand-600" /> Active (shown on the calendar)</label>
        <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
      </ActionForm>
    </Card>
    <Card className="p-4 text-sm">
      <h2 className="mb-1 font-medium">Calendar feed</h2>
      <p className="mb-2 text-stone-600">Subscribe in Google Calendar, Apple Calendar or Outlook to see {person.displayName.split(" ")[0]}&apos;s appointments alongside everything else. Changes show up within a few hours (each app decides how often it refreshes).</p>
      <input readOnly value={feedUrl} className="mb-2 w-full rounded border border-stone-300 bg-stone-50 px-2 py-1 text-xs" />
      <div className="mb-3 flex flex-wrap gap-2">
        <a href={webcal} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50">Apple / Outlook (webcal)</a>
        <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50">Add to Google Calendar</a>
      </div>
      <ul className="list-disc space-y-1 pl-4 text-xs text-stone-500">
        <li><strong>Google:</strong> Other calendars → + → From URL → paste the link.</li>
        <li><strong>Apple:</strong> File → New Calendar Subscription → paste the link.</li>
        <li><strong>Outlook:</strong> Add calendar → Subscribe from web.</li>
      </ul>
      <form action={resetCalendarToken} className="mt-3 border-t border-stone-200 pt-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="staffId" value={staffId} />
        <ConfirmSubmit title="Reset the calendar link?" body="Anyone using the current link stops receiving updates. You'll need to subscribe again." confirmLabel="Reset link" variant="ghost">Reset link</ConfirmSubmit>
      </form>
    </Card>
    </div>
  );
}
