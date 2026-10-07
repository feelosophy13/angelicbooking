import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { ConfirmSubmit } from "@/components/form";

export const metadata: Metadata = { title: "Locations" };
import { asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { BackLink, Button, Card, LinkButton, PageHeader } from "@/components/ui";
import { deleteLocation, setDefaultLocation } from "./actions";

export default async function LocationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const rows = await withTenant(business.id, (tx) => tx.select().from(schema.locations).orderBy(asc(schema.locations.createdAt)));
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Locations">
        <LinkButton href={`/app/${slug}/settings/locations/new`} variant="primary"><Plus className="h-4 w-4" /> New location</LinkButton>
      </PageHeader>
      <Card className="max-w-3xl">
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
                  <form action={deleteLocation}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={l.id} /><ConfirmSubmit title={`Remove ${l.name}?`} body="Staff assigned here become unassigned; past appointments keep their records." confirmLabel="Remove" variant="ghost">Remove</ConfirmSubmit></form>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-3 text-xs text-stone-500">Assign staff to a location on their profile. Clients pick the location first when booking online if you have more than one.</p>
    </>
  );
}
