"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { instantToISODate } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { bookAppointment, BookingError } from "@/server/booking";
import { notifyAppointment } from "@/lib/notify";

const schema = z.object({
  slug: z.string(),
  clientId: z.string().transform((v) => v || null),
  serviceId: z.string().min(1),
  staffId: z.string().min(1),
  startAt: z.string().datetime(),
  notes: z.string().trim().max(2000).transform((v) => v || null),
});

export type BookState = { error?: string } | undefined;

export async function book(_prev: BookState, formData: FormData): Promise<BookState> {
  const d = schema.parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "appointments.write.any");
  const startAt = new Date(d.startAt);
  try {
    const { appointmentId } = await bookAppointment({
      businessId: ctx.business.id,
      clientId: d.clientId,
      serviceId: d.serviceId,
      staffId: d.staffId,
      startAt,
      notes: d.notes,
      createdByUserId: ctx.user.id,
    });
    await notifyAppointment(ctx.business, appointmentId, "confirmation");
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  redirect(`/app/${d.slug}?date=${instantToISODate(startAt, ctx.business.timezone)}`);
}
