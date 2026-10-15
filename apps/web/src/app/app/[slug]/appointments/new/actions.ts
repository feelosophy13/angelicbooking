"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { and, eq, sql } from "drizzle-orm";
import { schema as dbSchema, withTenant } from "@angelic/db";
import { requireBookingAccess } from "@/server/appointment-access";
import { tzFor } from "@/server/locations";
import { addServiceToAppointment, bookAppointment, BookingError } from "@/server/booking";
import { createSeries } from "@/server/series";
import { notifyAppointment, scheduleReminderFor } from "@/lib/notify";
import { setFlash } from "@/lib/flash";

const schema = z.object({
  slug: z.string(),
  clientId: z.string().transform((v) => v || null),
  serviceId: z.string().min(1),
  staffId: z.string().min(1),
  // Either a slot (ISO instant) or an exact local time typed by the desk.
  startAt: z.string().optional().transform((v) => v || null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  customTime: z.string().optional().transform((v) => (v && /^\d{2}:\d{2}$/.test(v) ? v : null)),
  locationId: z.string().optional().transform((v) => v || null),
  notes: z.string().trim().max(2000).transform((v) => v || null),
  // Standing appointment: repeat every N weeks, M visits in total (including this one).
  sendConfirmation: z.string().optional(),
  repeatWeeks: z.coerce.number().int().min(0).max(12).default(0),
  repeatCount: z.coerce.number().int().min(2).max(52).default(6),
});

export type BookState = { error?: string } | undefined;

/** Book the extra services of a multi-service visit back to back after what is already on the ticket. */
async function appendServices(businessId: string, appointmentId: string, serviceIds: string[], staffId: string, actorUserId: string) {
  for (const serviceId of serviceIds) {
    const [row] = await withTenant(businessId, (tx) =>
      tx.select({ end: sql<Date | null>`max(${dbSchema.appointmentItems.endAt})` }).from(dbSchema.appointmentItems).where(and(eq(dbSchema.appointmentItems.appointmentId, appointmentId), sql`${dbSchema.appointmentItems.status} <> 'cancelled'`)),
    );
    const start = row?.end ? new Date(row.end) : null;
    if (!start) return;
    await addServiceToAppointment({ businessId, appointmentId, serviceId, staffId, startAt: start, actorUserId });
  }
}

export async function book(_prev: BookState, formData: FormData): Promise<BookState> {
  const d = schema.parse(Object.fromEntries(formData));
  const extraServiceIds = formData.getAll("extraServiceIds").map(String).filter((id) => id && id !== d.serviceId);
  const ctx = await requireBookingAccess(d.slug);
  if (ctx.access === "own" && d.staffId !== ctx.staffId) return { error: "You can only book appointments on your own calendar." };
  let startAt: Date;
  if (d.customTime && d.date) {
    const location = d.locationId ? await withTenant(ctx.business.id, (tx) => tx.query.locations.findFirst({ where: eq(dbSchema.locations.id, d.locationId!) })) : null;
    startAt = zonedToInstant(d.date, d.customTime, tzFor(ctx.business, location ?? null));
  } else if (d.startAt && !Number.isNaN(Date.parse(d.startAt))) {
    startAt = new Date(d.startAt);
  } else {
    return { error: "Pick a time or enter one." };
  }
  try {
    if (d.repeatWeeks > 0) {
      const r = await createSeries({
        businessId: ctx.business.id,
        timeZone: ctx.business.timezone,
        slotIntervalMin: ctx.business.slotIntervalMin,
        clientId: d.clientId,
        serviceId: d.serviceId,
        staffId: d.staffId,
        firstStartAt: startAt,
        intervalWeeks: d.repeatWeeks,
        occurrences: d.repeatCount,
        notes: d.notes,
        createdByUserId: ctx.user.id,
        locationId: d.locationId,
      });
      for (const c of r.created) await appendServices(ctx.business.id, c.appointmentId, extraServiceIds, d.staffId, ctx.user.id);
      // One confirmation (for the first visit) rather than one per occurrence; reminders for all.
      if (d.sendConfirmation) await notifyAppointment(ctx.business, r.created[0]!.appointmentId, "confirmation");
      for (const c of r.created.slice(1)) await scheduleReminderFor(ctx.business, c.appointmentId);
      const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: ctx.business.timezone });
      const skipped = r.skipped.length ? ` ${r.skipped.length} skipped (${r.skipped.map((s) => `${fmt.format(s.startAt)}: ${s.reason}`).join("; ")}).` : "";
      await setFlash(`Booked ${r.created.length} of ${d.repeatCount} visits.${skipped}`, r.skipped.length ? "info" : "success");
    } else {
      const { appointmentId } = await bookAppointment({
        businessId: ctx.business.id,
        clientId: d.clientId,
        serviceId: d.serviceId,
        staffId: d.staffId,
        startAt,
        notes: d.notes,
        createdByUserId: ctx.user.id,
        locationId: d.locationId,
      });
      await appendServices(ctx.business.id, appointmentId, extraServiceIds, d.staffId, ctx.user.id);
      if (d.sendConfirmation) await notifyAppointment(ctx.business, appointmentId, "confirmation");
    }
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  redirect(`/app/${d.slug}?date=${instantToISODate(startAt, ctx.business.timezone)}${d.locationId ? `&location=${d.locationId}` : ""}`);
}
