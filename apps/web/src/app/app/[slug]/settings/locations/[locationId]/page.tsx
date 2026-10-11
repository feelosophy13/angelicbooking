import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { staffLocationIndex } from "@/server/locations";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/utils";
import { FormPage, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { HoursEditor } from "@/components/hours-editor";
import { updateLocation } from "../actions";

export const metadata: Metadata = { title: "Edit location" };

export default async function EditLocationPage({ params }: { params: Promise<{ slug: string; locationId: string }> }) {
  const { slug, locationId } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const l = await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId) }));
  if (!l) notFound();
  // Who works here, from their weekly hours (each day carries a location) or their primary site.
  const [people, idx, locations] = await withTenant(business.id, async (tx) => Promise.all([
    tx.select({ id: schema.staff.id, name: schema.staff.displayName, locationId: schema.staff.locationId, takesAppointments: schema.staff.takesAppointments }).from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName)),
    staffLocationIndex(tx),
    tx.select({ id: schema.locations.id }).from(schema.locations),
  ]));
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const here = people
    .map((p) => {
      const days = [...(idx.byDay.get(p.id)?.entries() ?? [])].filter(([, locs]) => locs.has(l.id)).map(([wd]) => wd).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      // Someone with no hours yet counts at their primary site; owners/front desk without a calendar column are left out.
      const primaryOnly = !idx.byDay.has(p.id) && p.takesAppointments && (p.locationId === l.id || (!p.locationId && l.isDefault));
      return { ...p, days, primaryOnly };
    })
    .filter((p) => p.days.length || p.primaryOnly);
  return (
    <FormPage title={l.name} backHref={`/app/${slug}/settings/locations`} backLabel="Locations" width="max-w-xl">
      {locations.length > 1 ? (
        <div className="mb-5 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
          <p className="mb-1 font-medium text-stone-800">Who works here</p>
          {here.length === 0 ? (
            <p className="text-stone-500">Nobody yet. Set a provider&apos;s days here under Staff → Weekly hours.</p>
          ) : (
            <ul className="space-y-0.5">
              {here.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <Link href={`/app/${slug}/staff/${p.id}/hours`} className="hover:underline">{p.name}</Link>
                  <span className="text-xs text-stone-500">{p.days.length ? p.days.map((d) => DAY[d]).join(", ") : "primary location, no hours set"}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-stone-500">Days come from each person&apos;s weekly hours; change them under Staff → Weekly hours.</p>
        </div>
      ) : null}
      <ActionForm action={updateLocation} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="locationId" value={l.id} />
        <Field label="Name" name="name" required><Input name="name" defaultValue={l.name} required autoFocus /></Field>
        <Field label="Phone" name="phone"><Input name="phone" defaultValue={l.phone ?? ""} /></Field>
        <Field label="Address" name="addressLine1"><Input name="addressLine1" defaultValue={l.addressLine1 ?? ""} /></Field>
        <Field label="City" name="city"><Input name="city" defaultValue={l.city ?? ""} /></Field>
        <Field label="State" name="state"><Input name="state" defaultValue={l.state ?? ""} /></Field>
        <Field label="ZIP" name="postalCode"><Input name="postalCode" defaultValue={l.postalCode ?? ""} /></Field>
        <Field label="Timezone (if different)" name="timezone"><Select name="timezone" defaultValue={l.timezone ?? ""}><option value="">Same as business</option>{TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select></Field>
        <Field label="Sales tax (%)" name="taxPct" hint={`Blank = business default (${(business.taxRateBps / 100).toFixed(2)}%). Applies to sales taken at this location.`}><Input name="taxPct" type="number" step="0.01" min={0} max={30} defaultValue={l.taxRateBps == null ? "" : (l.taxRateBps / 100).toFixed(2)} placeholder={(business.taxRateBps / 100).toFixed(2)} /></Field>
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium text-stone-700">Opening hours</p>
          <p className="mb-2 text-xs text-stone-500">Shown on the booking page. Online bookings for staff at this location stay inside these hours even if a provider&apos;s own schedule runs longer.</p>
          <HoursEditor initial={l.hours ?? null} />
        </div>
        <div className="flex items-end"><SubmitButton pendingText="Saving…">Save location</SubmitButton></div>
      </ActionForm>
    </FormPage>
  );
}
