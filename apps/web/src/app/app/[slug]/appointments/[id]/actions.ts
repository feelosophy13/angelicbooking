"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import {
  addServiceToAppointment,
  BookingError,
  removeServiceFromAppointment,
  rescheduleService,
  setAppointmentStatus,
  updateAppointmentNotes,
} from "@/server/booking";

export type ActionState = { error?: string; ok?: boolean } | undefined;

const base = z.object({ slug: z.string(), appointmentId: z.string().min(1) });

export async function changeStatus(formData: FormData) {
  const { slug, appointmentId } = base.parse(Object.fromEntries(formData));
  const ctx = await requireAction(slug, "appointments.write.any");
  const status = z.enum(schema.appointmentStatus.enumValues).parse(formData.get("status"));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  await setAppointmentStatus(ctx.business.id, appointmentId, status, ctx.user.id, reason);
  revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
  revalidatePath(`/app/${slug}`);
}

export async function saveNotes(formData: FormData) {
  const { slug, appointmentId } = base.parse(Object.fromEntries(formData));
  const ctx = await requireAction(slug, "appointments.write.any");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  await updateAppointmentNotes(ctx.business.id, appointmentId, notes, ctx.user.id);
  revalidatePath(`/app/${slug}/appointments/${appointmentId}`);
}

export async function addService(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const d = base
    .extend({ serviceId: z.string().min(1), staffId: z.string().min(1), startAt: z.string().datetime() })
    .parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "appointments.write.any");
  try {
    await addServiceToAppointment({
      businessId: ctx.business.id,
      appointmentId: d.appointmentId,
      serviceId: d.serviceId,
      staffId: d.staffId,
      startAt: new Date(d.startAt),
      actorUserId: ctx.user.id,
    });
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

export async function moveService(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const d = base
    .extend({ itemId: z.string().min(1), startAt: z.string().datetime(), staffId: z.string().min(1) })
    .parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "appointments.write.any");
  try {
    await rescheduleService({
      businessId: ctx.business.id,
      itemId: d.itemId,
      newStartAt: new Date(d.startAt),
      newStaffId: d.staffId,
      actorUserId: ctx.user.id,
    });
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

export async function removeService(formData: FormData) {
  const d = base.extend({ itemId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "appointments.write.any");
  await removeServiceFromAppointment({ businessId: ctx.business.id, itemId: d.itemId, actorUserId: ctx.user.id });
  revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  revalidatePath(`/app/${d.slug}`);
}
