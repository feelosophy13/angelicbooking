import Link from "next/link";
import { asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/utils";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { createLocation, deleteLocation, saveCustomDomain, setDefaultLocation } from "./actions";

export default async function LocationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const rows = await withTenant(business.id, (tx) => tx.select().from(schema.locations).orderBy(asc(schema.locations.createdAt)));
  const host = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/^https?:\/\//, "");
  return (
    <>
      <PageHeader title="Locations & domain">
        <Link href={`/app/${slug}/settings`} className="text-sm text-brand-700 underline">← Settings</Link>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Locations</h2>
            <ul className="divide-y divide-stone-100">
              {rows.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.name}{l.isDefault ? <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-800">default</span> : null}</p>
                    <p className="text-xs text-stone-500">{[l.addressLine1, l.city, l.state, l.postalCode].filter(Boolean).join(", ") || "No address"}{l.phone ? ` · ${l.phone}` : ""}{l.timezone ? ` · ${l.timezone}` : ""}</p>
                  </div>
                  {!l.isDefault ? (
                    <>
                      <form action={setDefaultLocation}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={l.id} /><Button size="sm" variant="ghost" type="submit">Make default</Button></form>
                      <form action={deleteLocation}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={l.id} /><Button size="sm" variant="ghost" type="submit">Remove</Button></form>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 font-medium">Add location</h2>
            <form action={createLocation} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="slug" value={slug} />
              <Field label="Name"><Input name="name" required placeholder="Fairfax" /></Field>
              <Field label="Phone"><Input name="phone" /></Field>
              <Field label="Address"><Input name="addressLine1" /></Field>
              <Field label="City"><Input name="city" /></Field>
              <Field label="State"><Input name="state" /></Field>
              <Field label="ZIP"><Input name="postalCode" /></Field>
              <Field label="Timezone (if different)"><Select name="timezone" defaultValue=""><option value="">Same as business</option>{TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select></Field>
              <div className="flex items-end"><Button type="submit" variant="secondary">Add location</Button></div>
            </form>
            <p className="mt-3 text-xs text-stone-500">Assign staff to a location on their Staff page. Clients pick the location first when booking online if you have more than one.</p>
          </Card>
        </div>
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Custom booking domain</h2>
          <p className="mb-3 text-xs text-stone-500">Serve your booking page from your own hostname instead of {host}/book/{business.slug}.</p>
          <form action={saveCustomDomain} className="space-y-2">
            <input type="hidden" name="slug" value={slug} />
            <Field label="Hostname"><Input name="customDomain" defaultValue={business.customDomain ?? ""} placeholder="book.yoursalon.com" /></Field>
            <Button type="submit" variant="secondary" size="sm">Save</Button>
          </form>
          <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-stone-600">
            <li>Add a CNAME record for that hostname pointing at <code>{host || "your app host"}</code>.</li>
            <li>Add the hostname to your hosting provider so it issues an SSL certificate (Vercel: Project → Domains; DigitalOcean: App → Domains).</li>
            <li>Visitors to that hostname land directly on your booking page.</li>
          </ol>
        </Card>
      </div>
    </>
  );
}
