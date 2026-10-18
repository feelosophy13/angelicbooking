import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { LashMapEyes } from "@/components/lash-map";
import { canWriteLashMaps } from "@/server/lash-maps";
import { relative } from "@/lib/format";
import { LashMapEditor } from "../lash-map-editor";
import { deleteLashMap } from "../actions";

export const metadata: Metadata = { title: "Lash map" };

export default async function LashMapPage({ params }: { params: Promise<{ slug: string; clientId: string; mapId: string }> }) {
  const { slug, clientId, mapId } = await params;
  const ctx = await requireAction(slug, "clients.notes");
  const data = await withTenant(ctx.business.id, async (tx) => {
    const map = await tx.query.lashMaps.findFirst({ where: and(eq(schema.lashMaps.id, mapId), eq(schema.lashMaps.clientId, clientId)) });
    if (!map) return null;
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId), columns: { firstName: true, lastName: true } });
    return { map, client, write: await canWriteLashMaps(tx, ctx, clientId) };
  });
  if (!data?.client) notFound();
  const { map, client, write } = data;
  const name = `${client.firstName} ${client.lastName}`.trim();
  const clientHref = `/app/${slug}/clients/${clientId}`;
  if (!write) {
    return (
      <FormPage title={map.title} backHref={clientHref} backLabel={name}>
        <LashMapEyes zones={map.zones} rightZones={map.rightZones} />
        {map.notes ? <p className="mt-3 whitespace-pre-line text-sm text-stone-700">{map.notes}</p> : null}
        <p className="mt-3 text-xs text-stone-500">Updated {relative(map.updatedAt)}</p>
      </FormPage>
    );
  }
  return (
    <>
      <FormPage title={`${map.title} · ${name}`} backHref={clientHref} backLabel={name}>
        <LashMapEditor slug={slug} clientId={clientId} map={{ id: map.id, title: map.title, notes: map.notes, zones: map.zones, rightZones: map.rightZones }} appointmentId={null} returnTo="client" cancelHref={clientHref} />
      </FormPage>
      <div className="mt-4 flex max-w-2xl items-center justify-between gap-3 text-sm">
        <Link href={`${clientHref}/lash-maps/new?from=${map.id}`} className="text-brand-700 hover:underline">Start a new map from this one</Link>
        <form action={deleteLashMap}>
          <input type="hidden" name="slug" value={slug} /><input type="hidden" name="clientId" value={clientId} /><input type="hidden" name="mapId" value={map.id} />
          <ConfirmSubmit title="Delete this lash map?" body="It's removed from the client's record for good." confirmLabel="Delete" variant="ghost" className="text-stone-500 hover:text-red-600">Delete lash map</ConfirmSubmit>
        </form>
      </div>
    </>
  );
}
