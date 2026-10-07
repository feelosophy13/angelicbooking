import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { updateStaffProfile } from "../actions";

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
  return (
    <Card className="max-w-lg p-4">
      <form action={updateStaffProfile} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="staffId" value={staffId} />
        <Field label="Name"><Input name="displayName" defaultValue={person.displayName} required /></Field>
        <Field label="Email"><Input name="email" type="email" defaultValue={person.email ?? ""} /></Field>
        <Field label="Phone"><Input name="phone" defaultValue={person.phone ?? ""} /></Field>
        <Field label="Calendar colour"><Input name="color" type="color" defaultValue={person.color} className="h-10 w-24 p-1" /></Field>
        {locations.length > 1 ? (
          <Field label="Primary location">
            <Select name="locationId" defaultValue={person.locationId ?? ""}>
              <option value="">Any / unassigned</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="bookableOnline" defaultChecked={person.bookableOnline} className="h-4 w-4 accent-brand-600" /> Bookable online</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={person.active} className="h-4 w-4 accent-brand-600" /> Active (shown on the calendar)</label>
        <Button type="submit">Save profile</Button>
      </form>
    </Card>
  );
}
