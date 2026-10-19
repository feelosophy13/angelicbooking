"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAppointmentAccess } from "@/server/appointment-access";
import { coversLine } from "@/lib/appointment-access";
import { PermissionError } from "@/lib/tenant";
import { FileError } from "@/lib/files";
import { PHASES, parseTags } from "@/lib/visit-photos";
import { addVisitPhotos, removeVisitPhoto, setPairDetails } from "@/server/visit-photos";

export type PhotoState = { error?: string } | undefined;

const pair = z.object({ slug: z.string(), appointmentId: z.string().min(1), serviceId: z.string().default(""), staffId: z.string().default("") });

function refresh(slug: string, appointmentId: string) {
  revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
  revalidatePath(`/app/${slug}/gallery`);
}

/** Upload one or more before or after photos for a service on the visit. */
export async function addPhotos(_prev: PhotoState, formData: FormData): Promise<PhotoState> {
  const d = pair.extend({ phase: z.enum(PHASES) }).parse(Object.fromEntries(formData));
  const ctx = await requireAppointmentAccess(d.slug, d.appointmentId, "write", { shared: "allow" });
  if (!coversLine(ctx.access, ctx.staffId ?? null, d.staffId || null)) return { error: "On a visit you share with a colleague, you can only add photos of your own service." };
  try {
    await addVisitPhotos({ businessId: ctx.business.id, appointmentId: d.appointmentId, serviceId: d.serviceId || null, staffId: d.staffId || null, phase: d.phase, files: formData.getAll("files").filter((f): f is File => f instanceof File), actorUserId: ctx.user.id });
  } catch (e) {
    if (e instanceof FileError) return { error: e.message };
    throw e;
  }
  refresh(d.slug, d.appointmentId);
}

/** Save the tags and the "may be shown publicly" consent for a pair. */
export async function savePairDetails(formData: FormData) {
  const d = pair.parse(Object.fromEntries(formData));
  const ctx = await requireAppointmentAccess(d.slug, d.appointmentId, "write", { shared: "allow" });
  if (!coversLine(ctx.access, ctx.staffId ?? null, d.staffId || null)) throw new PermissionError();
  await setPairDetails({ businessId: ctx.business.id, appointmentId: d.appointmentId, serviceId: d.serviceId || null, staffId: d.staffId || null, tags: parseTags(String(formData.get("tags") ?? "")), shareOk: formData.get("shareOk") === "on", actorUserId: ctx.user.id });
  refresh(d.slug, d.appointmentId);
}

export async function removePhoto(formData: FormData) {
  const d = z.object({ slug: z.string(), appointmentId: z.string().min(1), photoId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAppointmentAccess(d.slug, d.appointmentId, "write", { shared: "allow" });
  if (ctx.access === "shared") {
    const photo = await withTenant(ctx.business.id, (tx) => tx.query.visitPhotos.findFirst({ where: eq(schema.visitPhotos.id, d.photoId), columns: { staffId: true } }));
    if (!coversLine(ctx.access, ctx.staffId ?? null, photo?.staffId)) throw new PermissionError();
  }
  await removeVisitPhoto({ businessId: ctx.business.id, photoId: d.photoId, actorUserId: ctx.user.id });
  refresh(d.slug, d.appointmentId);
}
