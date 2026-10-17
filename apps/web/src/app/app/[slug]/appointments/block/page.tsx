import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { requireBlockAccess } from "@/server/appointment-access";
import { listLocations, tzFor } from "@/server/locations";
import { FormPage, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { createBlock } from "./actions";

export const metadata: Metadata = { title: "Block time" };

type SP = { date?: string; staffId?: string; time?: string; location?: string };

/** Lunch, a late start, a meeting: take a stretch of a provider's day off the books. */
export default async function BlockTimePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, access, staffId: myStaffId } = await requireBlockAccess(slug);
  const locations = await listLocations(business.id);
  const location = locations.length > 1 ? (locations.find((l) => l.id === sp.location) ?? null) : null;
  const tz = tzFor(business, location);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : instantToISODate(new Date(), tz);
  const staff = await withTenant(business.id, (tx) => tx.select({ id: schema.staff.id, displayName: schema.staff.displayName }).from(schema.staff).where(access === "own" && myStaffId ? and(eq(schema.staff.active, true), eq(schema.staff.id, myStaffId)) : eq(schema.staff.active, true)).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName)));
  const start = /^\d{2}:\d{2}$/.test(sp.time ?? "") ? sp.time! : "12:00";
  const [h, m] = start.split(":").map(Number);
  const end = `${String(Math.min(23, h! + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return (
    <FormPage title="Block time" backHref={`/app/${slug}?date=${date}`} backLabel="Calendar">
      <ActionForm action={createBlock}>
        <input type="hidden" name="slug" value={slug} />
        {location ? <input type="hidden" name="locationId" value={location.id} /> : null}
        {staff.length === 1 ? <input type="hidden" name="staffId" value={staff[0]!.id} /> : (
          <Field label="Staff member" name="staffId" required>
            <Select name="staffId" defaultValue={staff.some((s) => s.id === sp.staffId) ? sp.staffId : staff[0]?.id} required>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Date" name="date" required><Input name="date" type="date" defaultValue={date} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" name="start" required><Input name="start" type="time" defaultValue={start} required /></Field>
          <Field label="To" name="end" required><Input name="end" type="time" defaultValue={end} required /></Field>
        </div>
        <Field label="Reason" name="reason" hint="Shown on the calendar, e.g. Lunch, Training, Late start."><Input name="reason" placeholder="Lunch" /></Field>
        <SubmitButton pendingText="Blocking…">Block this time</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
