"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { BookingError, rescheduleService, setAppointmentStatus } from "@/server/booking";
import { notifyAppointment } from "@/lib/notify";
import { schema as dbSchema, withTenant } from "@angelic/db";
import { eq } from "drizzle-orm";

const statusSchema = z.enum(schema.appointmentStatus.enumValues);

export async function updateAppointmentStatus(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "appointments.write.any");
  const appointmentId = String(formData.get("appointmentId"));
  const status = statusSchema.parse(formData.get("status"));
  await setAppointmentStatus(ctx.business.id, appointmentId, status, ctx.user.id);
  if (status === "cancelled") await notifyAppointment(ctx.business, appointmentId, "cancellation");
  revalidatePath(`/app/${slug}`);
}

export type MoveResult = { ok: true } | { ok: false; error: string };

/** Called from the calendar after a drag. */
export async function moveAppointmentItem(input: {
  slug: string;
  itemId: string;
  newStartISO: string;
  newStaffId?: string | null;
}): Promise<MoveResult> {
  const parsed = z
    .object({ slug: z.string(), itemId: z.string().min(1), newStartISO: z.string().datetime(), newStaffId: z.string().nullish() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid move" };
  const ctx = await requireAction(parsed.data.slug, "appointments.write.any");
  try {
    await rescheduleService({
      businessId: ctx.business.id,
      itemId: parsed.data.itemId,
      newStartAt: new Date(parsed.data.newStartISO),
      newStaffId: parsed.data.newStaffId ?? null,
      actorUserId: ctx.user.id,
    });
    const item = await withTenant(ctx.business.id, (tx) => tx.query.appointmentItems.findFirst({ where: eq(dbSchema.appointmentItems.id, parsed.data.itemId) }));
    if (item) await notifyAppointment(ctx.business, item.appointmentId, "rescheduled");
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath(`/app/${parsed.data.slug}`);
  return { ok: true };
}
