import { ImageField } from "@/components/image-field";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card, Input, Select, Textarea, Checkbox } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { generateClockPin, resetCalendarToken, updateStaffProfile } from "../actions";
import { ConfirmSubmit } from "@/components/form";
import { Disclosure } from "@/components/disclosure";
import { CalendarFields } from "./calendar-fields";
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" name="displayName" required hint="What clients see on the booking page and in messages. A first name or nickname is fine."><Input name="displayName" defaultValue={person.displayName} required /></Field>
          <Field label="Full name" name="fullName" hint="Private: payroll, pay sheets and your records only."><Input name="fullName" defaultValue={person.fullName ?? ""} placeholder="Legal name, if different" /></Field>
        </div>
        <Field label="Email" name="email"><Input name="email" type="email" defaultValue={person.email ?? ""} /></Field>
        <Field label="Phone" name="phone"><Input name="phone" defaultValue={person.phone ?? ""} /></Field>
        <Field label="Calendar colour" name="color"><Input name="color" type="color" defaultValue={person.color} className="h-10 w-24 p-1" /></Field>
        <Field label="Photo" name="photo" hint="Shown to clients when they pick a provider, and on the staff list. A square crop looks best.">
          <ImageField name="photo" removeName="removePhoto" current={person.photoUrl} shape="round" placeholder={person.displayName.slice(0, 1)} placeholderColor={person.color} />
        </Field>
        <Field label="Photos of their work" name="work0" hint="Up to three pictures clients can tap on the booking page to see the style before choosing. Lashes, colour, brows, whatever they are known for.">
          <div className="flex flex-wrap gap-3">
            {[0, 1, 2].map((i) => <ImageField key={i} name={`work${i}`} removeName={`removeWork${i}`} current={person.workPhotoUrls[i] ?? null} placeholder="+" />)}
          </div>
        </Field>
        <Field label="Title" name="position" hint="Shown to clients next to the name when they pick a provider, so a higher price makes sense: Master Stylist, Senior Esthetician, Lash Artist."><Input name="position" defaultValue={person.position ?? ""} maxLength={60} placeholder="Master Stylist" /></Field>
        <Field label="Bio" name="bio" hint="A sentence or two clients see on the booking page: specialties, years of experience."><Textarea name="bio" rows={4} defaultValue={person.bio ?? ""} maxLength={300} placeholder="Balayage specialist with 8 years behind the chair." /></Field>
        {locations.length > 1 ? (
          <Field label="Primary location" name="locationId">
            <Select name="locationId" defaultValue={person.locationId ?? ""}>
              <option value="">Any / unassigned</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <CalendarFields takesAppointments={person.takesAppointments} bookableOnline={person.bookableOnline} />
        <Checkbox name="active" defaultChecked={person.active} label="Active (shown on the calendar)" />
        <details className="rounded-lg border border-stone-200 p-3">
          <summary className="cursor-pointer select-none text-sm font-medium text-stone-700 marker:content-none [&::-webkit-details-marker]:hidden">Clock-in PIN <span className="font-normal text-stone-500">· {person.clockPinHash ? "set" : "not set"}</span></summary>
          <Field label="" name="clockPin" hint={person.clockPinHash ? "Type a new 4–6 digit PIN to change it, or tick Remove." : "4–6 digits typed on the clock-in QR page (Time clock → QR code). No PIN = can't use the kiosk."} className="mt-2">
            <div className="flex flex-wrap items-center gap-3">
              <Input name="clockPin" inputMode="numeric" pattern="\\d{4,6}" maxLength={6} placeholder={person.clockPinHash ? "••••" : "e.g. 4821"} className="w-32" autoComplete="off" />
              {person.clockPinHash ? <Checkbox name="clearPin" label="Remove PIN" /> : null}
            </div>
          </Field>
        </details>
        <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
      </ActionForm>
      <form action={generateClockPin} className="mt-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="staffId" value={staffId} />
        <button type="submit" className="text-xs text-stone-500 underline hover:text-stone-800">Generate a random clock-in PIN</button>
      </form>
    </Card>
    <Disclosure title="Calendar feed" hint="Google, Apple or Outlook" className="self-start text-sm">
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
    </Disclosure>
    </div>
  );
}
