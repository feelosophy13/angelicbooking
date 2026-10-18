"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { LashMapError, parseLashZones } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { PermissionError, requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { canWriteLashMaps } from "@/server/lash-maps";

const saveSchema = z.object({
  slug: z.string(),
  clientId: f.id(),
  mapId: z.string().optional().transform((v) => v || null),
  appointmentId: z.string().optional().transform((v) => v || null),
  /** Where to land after saving: the visit the map was opened from, else the client. */
  returnTo: z.enum(["client", "appointment"]).optional(),
  title: f.text(1, 80),
  notes: f.optional(2000),
  zones: z.string(),
  /** Set only when the right eye differs; `zones` is then the left eye. */
  rightZones: z.string().optional().transform((v) => v || null),
});

// A lash map is a client note in picture form, so it is read (and written, with canWriteLashMaps) under clients.notes.
export const saveLashMap = formAction(saveSchema, async (d) => {
  const ctx = await requireAction(d.slug, "clients.notes");
  let zones, rightZones;
  try {
    zones = parseLashZones(JSON.parse(d.zones), d.rightZones ? "Left eye" : undefined);
    rightZones = d.rightZones ? parseLashZones(JSON.parse(d.rightZones), "Right eye") : null;
  } catch (e) {
    throw new FormError(e instanceof LashMapError ? e.message : "The lash map couldn't be read. Reload and try again.", "zones");
  }
  await withTenant(ctx.business.id, async (tx) => {
    if (!(await canWriteLashMaps(tx, ctx, d.clientId))) throw new PermissionError();
    // The visit must be this client's own (a foreign key alone would accept another business's appointment).
    if (d.appointmentId && !(await tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, d.appointmentId), eq(schema.appointments.clientId, d.clientId)), columns: { id: true } }))) {
      throw new FormError("That visit isn't this client's.");
    }
    if (d.mapId) {
      const updated = await tx
        .update(schema.lashMaps)
        .set({ title: d.title, notes: d.notes, zones, rightZones, updatedAt: new Date() })
        .where(and(eq(schema.lashMaps.id, d.mapId), eq(schema.lashMaps.clientId, d.clientId)))
        .returning({ id: schema.lashMaps.id });
      if (!updated.length) throw new FormError("This lash map was deleted.");
    } else {
      await tx.insert(schema.lashMaps).values({ businessId: ctx.business.id, clientId: d.clientId, appointmentId: d.appointmentId, authorUserId: ctx.user.id, title: d.title, notes: d.notes, zones, rightZones });
    }
  });
  await setFlash(d.mapId ? "Lash map saved" : "Lash map added");
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
  if (d.appointmentId) revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  redirect(d.returnTo === "appointment" && d.appointmentId ? `/app/${d.slug}/appointments/${d.appointmentId}` : `/app/${d.slug}/clients/${d.clientId}`);
});

export async function deleteLashMap(formData: FormData) {
  const d = z.object({ slug: z.string(), clientId: z.string(), mapId: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "clients.notes");
  await withTenant(ctx.business.id, async (tx) => {
    if (!(await canWriteLashMaps(tx, ctx, d.clientId))) throw new PermissionError();
    await tx.delete(schema.lashMaps).where(and(eq(schema.lashMaps.id, d.mapId), eq(schema.lashMaps.clientId, d.clientId)));
  });
  await setFlash("Lash map deleted");
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
  redirect(`/app/${d.slug}/clients/${d.clientId}`);
}
