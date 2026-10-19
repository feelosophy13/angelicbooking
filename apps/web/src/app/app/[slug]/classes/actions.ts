"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PermissionError, requireBusiness } from "@/lib/tenant";
import { canManageClass } from "@/lib/visibility";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { BookingError } from "@/server/booking";
import { cancelSession, createSession, enrolClient } from "@/server/classes";
import { notifyAppointment } from "@/lib/notify";

/** Who may run a class (A2): anyone with "Run every class"; with "Run their own classes", only a class they teach. */
async function classCtx(slug: string, instructorStaffId: string | null) {
  const ctx = await requireBusiness(slug);
  if (!canManageClass(ctx.permissions, ctx.staffId ?? null, instructorStaffId)) throw new PermissionError();
  return ctx;
}
async function instructorOf(businessId: string, sessionId: string) {
  const s = await withTenant(businessId, (tx) => tx.query.classSessions.findFirst({ where: eq(schema.classSessions.id, sessionId), columns: { staffId: true } }));
  return s?.staffId ?? null;
}

export const scheduleClass = formAction(
  z.object({ slug: z.string(), serviceId: f.id(), staffId: f.id(), startAt: z.string().datetime("Pick one of the open times"), capacity: z.string().trim().optional(), notes: f.optional(300) }),
  async (d) => {
    const ctx = await classCtx(d.slug, d.staffId);
    const capacity = d.capacity ? Number(d.capacity) : null;
    if (d.capacity && (!Number.isInteger(capacity) || capacity! < 1)) throw new FormError("Enter a whole number", "capacity");
    try {
      const row = await createSession({ businessId: ctx.business.id, timeZone: ctx.business.timezone, slotIntervalMin: ctx.business.slotIntervalMin, serviceId: d.serviceId, staffId: d.staffId, startAt: new Date(d.startAt), capacity, notes: d.notes, actorUserId: ctx.user.id });
      await setFlash("Class scheduled");
      revalidatePath(`/app/${d.slug}/classes`);
      revalidatePath(`/app/${d.slug}`);
      redirect(`/app/${d.slug}/classes/${row.id}`);
    } catch (e) {
      if (e instanceof BookingError) throw new FormError(e.message);
      throw e;
    }
  },
);

export const addToClass = formAction(
  z.object({ slug: z.string(), sessionId: f.id(), clientId: z.string().transform((v) => v || null), notes: f.optional(300) }),
  async (d) => {
    const ctx = await classCtx(d.slug, await instructorOf((await requireBusiness(d.slug)).business.id, d.sessionId));
    try {
      const r = await enrolClient({ businessId: ctx.business.id, sessionId: d.sessionId, clientId: d.clientId, notes: d.notes, actorUserId: ctx.user.id });
      await notifyAppointment(ctx.business, r.appointmentId, "confirmation");
    } catch (e) {
      if (e instanceof BookingError) throw new FormError(e.message);
      throw e;
    }
    revalidatePath(`/app/${d.slug}/classes/${d.sessionId}`);
    revalidatePath(`/app/${d.slug}`);
    return "Added to the class";
  },
);

export async function cancelClass(formData: FormData) {
  const d = z.object({ slug: z.string(), sessionId: z.string().min(1), reason: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await classCtx(d.slug, await instructorOf((await requireBusiness(d.slug)).business.id, d.sessionId));
  const { ids, refundFailures } = await cancelSession({ businessId: ctx.business.id, sessionId: d.sessionId, actorUserId: ctx.user.id, reason: d.reason?.trim() || null });
  for (const id of ids) await notifyAppointment(ctx.business, id, "cancellation");
  if (refundFailures) await setFlash(`Class cancelled, but ${refundFailures} deposit refund${refundFailures === 1 ? "" : "s"} didn't go through. Refund ${refundFailures === 1 ? "it" : "them"} from the appointment page.`, "error");
  else await setFlash(ids.length ? `Class cancelled; ${ids.length} client${ids.length === 1 ? "" : "s"} notified and any deposits refunded` : "Class cancelled");
  revalidatePath(`/app/${d.slug}/classes`);
  revalidatePath(`/app/${d.slug}`);
  redirect(`/app/${d.slug}/classes`);
}
