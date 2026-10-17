import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ConfirmSubmit } from "@/components/form";

export const metadata: Metadata = { title: "Locations" };
import { asc, eq } from "drizzle-orm";
import { staffLocationIndex } from "@/server/locations";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { BackLink, Button, Card, LinkButton, PageHeader } from "@/components/ui";
import { RowLink, rowClass, rowControl } from "@/components/row";
import { deleteLocation, setDefaultLocation } from "./actions";
import { describeHours } from "@/lib/hours";

export default async function LocationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const [rows, idx, people] = await withTenant(business.id, (tx) => Promise.all([
    tx.select().from(schema.locations).orderBy(asc(schema.locations.createdAt)),
    staffLocationIndex(tx),
    tx.select({ id: schema.staff.id, locationId: schema.staff.locationId, takesAppointments: schema.staff.takesAppointments }).from(schema.staff).where(eq(schema.staff.active, true)),
  ]));
  // People with hours at the site, plus providers whose primary site it is and who have no hours yet.
  const staffAt = (locationId: string, isDefault: boolean) => people.filter((p) => idx.any.get(p.id)?.has(locationId) || (!idx.byDay.has(p.id) && p.takesAppointments && (p.locationId === locationId || (!p.locationId && isDefault)))).length;
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Locations">
        <LinkButton href={`/app/${slug}/settings/locations/new`} variant="primary"><Plus className="h-4 w-4" /> New location</LinkButton>
      </PageHeader>
      <Card>
        <ul className="divide-y divide-stone-100">
          {rows.map((l) => (
            <li key={l.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${rowClass}`}>
              <div className="min-w-0 flex-1">
                {/* The name link covers the whole row (after:inset-0); the action buttons sit above it. */}
                <p className="font-medium"><RowLink href={`/app/${slug}/settings/locations/${l.id}`}>{l.name}</RowLink>{l.isDefault ? <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-800">default</span> : null}</p>
                <p className="text-xs text-stone-500">{[l.addressLine1, l.city, l.state, l.postalCode].filter(Boolean).join(", ") || "No address"}{l.phone ? ` · ${l.phone}` : ""}{l.timezone ? ` · ${l.timezone}` : ""}</p>
                <p className="text-xs text-stone-500">{l.hours ? describeHours(l.hours).join(" · ") : "No opening hours set"}</p>
                {rows.length > 1 ? <p className="text-xs text-stone-500">{staffAt(l.id, l.isDefault) === 1 ? "1 staff member" : `${staffAt(l.id, l.isDefault)} staff members`} work here</p> : null}
              </div>
              <div className={`flex items-center gap-1 ${rowControl}`}>
                {!l.isDefault ? (
                  <>
                    <form action={setDefaultLocation}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={l.id} /><Button size="sm" variant="ghost" type="submit">Make default</Button></form>
                    <form action={deleteLocation}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={l.id} /><ConfirmSubmit title={`Remove ${l.name}?`} body="Staff assigned here become unassigned; past appointments keep their records." confirmLabel="Remove" variant="ghost">Remove</ConfirmSubmit></form>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-3 text-xs text-stone-500">Assign staff to a location on their profile. Clients pick the location first when booking online if you have more than one.</p>
    </>
  );
}
