import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { starterLashZones } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { PermissionError, requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { canWriteLashMaps, lashMapsFor } from "@/server/lash-maps";
import { LashMapEditor } from "../lash-map-editor";

export const metadata: Metadata = { title: "New lash map" };

/** `?appointmentId=` ties the map to a visit (and returns there); `?from=` starts from an earlier map, else from the client's latest. */
export default async function NewLashMapPage({ params, searchParams }: { params: Promise<{ slug: string; clientId: string }>; searchParams: Promise<{ appointmentId?: string; from?: string }> }) {
  const { slug, clientId } = await params;
  const { appointmentId, from } = await searchParams;
  const ctx = await requireAction(slug, "clients.read");
  const data = await withTenant(ctx.business.id, async (tx) => {
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId), columns: { id: true, firstName: true, lastName: true } });
    if (!client) return null;
    if (!(await canWriteLashMaps(tx, ctx, clientId))) throw new PermissionError();
    const visit = appointmentId ? await tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, appointmentId), eq(schema.appointments.clientId, clientId)), columns: { id: true } }) : null;
    const base = from ? await tx.query.lashMaps.findFirst({ where: and(eq(schema.lashMaps.id, from), eq(schema.lashMaps.clientId, clientId)) }) : (await lashMapsFor(tx, clientId, 1))[0];
    return { client, visit, base };
  });
  if (!data) notFound();
  const { client, visit, base } = data;
  const name = `${client.firstName} ${client.lastName}`.trim();
  const back = visit ? { href: `/app/${slug}/appointments/${visit.id}`, label: "Appointment" } : { href: `/app/${slug}/clients/${clientId}`, label: name };
  return (
    <FormPage title={`New lash map for ${name}`} backHref={back.href} backLabel={back.label}>
      <LashMapEditor
        slug={slug}
        clientId={clientId}
        map={{ id: null, title: base?.title ?? "", notes: base?.notes ?? null, zones: base?.zones ?? starterLashZones(6) }}
        appointmentId={visit?.id ?? null}
        returnTo={visit ? "appointment" : "client"}
        cancelHref={back.href}
      />
    </FormPage>
  );
}
