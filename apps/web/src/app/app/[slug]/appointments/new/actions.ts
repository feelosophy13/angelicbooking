"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can, instantToISODate, zonedToInstant } from "@angelic/core";
import { and, eq, sql } from "drizzle-orm";
import { schema as dbSchema, withTenant } from "@angelic/db";
import { requireBookingAccess } from "@/server/appointment-access";
import { tzFor } from "@/server/locations";
import { addServiceToAppointment, bookAppointment, BookingError, OverlapError } from "@/server/booking";
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
  // "Book anyway": the desk chose to double-book after seeing the clash.
  doubleBook: z.string().optional().transform((v) => v === "1"),
});

/** `overlap` echoes the time and person that clashed, so the form offers "Book anyway" only while they are still picked. */
export type BookState = { error?: string; overlap?: { staffId: string; startAt: string; customTime: string } } | undefined;

/** Book the extra services of a multi-service visit back to back after what is already on the ticket. */
/**
 * Add the visit's further services. If one can't be added (its time is taken), the whole new appointment is taken back out, so the desk
 * never ends up with half a booking that a retry would then duplicate.
 */
async function appendServices(businessId: string, appointmentId: string, serviceIds: string[], staffId: string, actorUserId: string, allowOverlap = false) {
  try {
    await appendServicesOnce(businessId, appointmentId, serviceIds, staffId, actorUserId, allowOverlap);
  } catch (e) {
    await withTenant(businessId, (tx) => tx.delete(dbSchema.appointments).where(eq(dbSchema.appointments.id, appointmentId)));
    throw e;
  }
}

async function appendServicesOnce(businessId: string, appointmentId: string, serviceIds: string[], staffId: string, actorUserId: string, allowOverlap: boolean) {
  for (const serviceId of serviceIds) {
    const [row] = await withTenant(businessId, (tx) =>
      tx.select({ end: sql<Date | null>`max(${dbSchema.appointmentItems.endAt})` }).from(dbSchema.appointmentItems).where(and(eq(dbSchema.appointmentItems.appointmentId, appointmentId), sql`${dbSchema.appointmentItems.status} <> 'cancelled'`)),
    );
    const start = row?.end ? new Date(row.end) : null;
    if (!start) return;
    await addServiceToAppointment({ businessId, appointmentId, serviceId, staffId, startAt: start, actorUserId, allowOverlap });
  }
}

export async function book(_prev: BookState, formData: FormData): Promise<BookState> {
  const d = schema.parse(Object.fromEntries(formData));
  const extraServiceIds = formData.getAll("extraServiceIds").map(String).filter((id) => id && id !== d.serviceId);
  const ctx = await requireBookingAccess(d.slug);
  if (ctx.access === "own" && d.staffId !== ctx.staffId) return { error: "You can only book appointments on your own calendar." };
  // Ids from the form must be this business's own (foreign keys don't see row-level security).
  const foreign = await withTenant(ctx.business.id, async (tx) => {
    if (d.clientId && !(await tx.query.clients.findFirst({ where: eq(dbSchema.clients.id, d.clientId), columns: { id: true } }))) return "client";
    if (d.locationId && !(await tx.query.locations.findFirst({ where: eq(dbSchema.locations.id, d.locationId), columns: { id: true } }))) return "location";
    return null;
  });
  if (foreign) return { error: `That ${foreign} isn't available. Reload the page and try again.` };
  let startAt: Date;
  if (d.customTime && d.date) {
    const location = d.locationId ? await withTenant(ctx.business.id, (tx) => tx.query.locations.findFirst({ where: eq(dbSchema.locations.id, d.locationId!) })) : null;
    startAt = zonedToInstant(d.date, d.customTime, tzFor(ctx.business, location ?? null));
  } else if (d.startAt && !Number.isNaN(Date.parse(d.startAt))) {
    startAt = new Date(d.startAt);
  } else {
    return { error: "Pick a time or enter one." };
  }
  // Double-booking is for whoever can manage every calendar (front desk, managers), and only for a single visit: a series skips clashing dates.
  const mayDoubleBook = can(ctx.permissions, "appointments.write.any") && d.repeatWeeks === 0;
  const allowOverlap = d.doubleBook && mayDoubleBook;
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
      // A date where the extra services don't fit is taken back out and reported with the other skipped dates.
      const kept: typeof r.created = [];
      const skippedDates = [...r.skipped];
      for (const c of r.created) {
        try {
          await appendServices(ctx.business.id, c.appointmentId, extraServiceIds, d.staffId, ctx.user.id);
          kept.push(c);
        } catch (e) {
          if (!(e instanceof BookingError)) throw e;
          skippedDates.push({ startAt: c.startAt, reason: "the extra services don't fit" });
        }
      }
      if (!kept.length) return { error: "None of those dates have room for every service." };
      // One confirmation (for the first visit) rather than one per occurrence; reminders for all.
      // Unticking "Send confirmation" skips the confirmation, not the reminders.
      if (d.sendConfirmation) await notifyAppointment(ctx.business, kept[0]!.appointmentId, "confirmation");
      else await scheduleReminderFor(ctx.business, kept[0]!.appointmentId);
      for (const c of kept.slice(1)) await scheduleReminderFor(ctx.business, c.appointmentId);
      const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: ctx.business.timezone });
      const skipped = skippedDates.length ? ` ${skippedDates.length} skipped (${skippedDates.map((s) => `${fmt.format(s.startAt)}: ${s.reason}`).join("; ")}).` : "";
      await setFlash(`Booked ${kept.length} of ${d.repeatCount} visits.${skipped}`, skippedDates.length ? "info" : "success");
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
        allowOverlap,
      });
      await appendServices(ctx.business.id, appointmentId, extraServiceIds, d.staffId, ctx.user.id, allowOverlap);
      // Unticking "Send confirmation" skips the confirmation, not the reminders.
      if (d.sendConfirmation) await notifyAppointment(ctx.business, appointmentId, "confirmation");
      else await scheduleReminderFor(ctx.business, appointmentId);
    }
  } catch (e) {
    if (e instanceof OverlapError && mayDoubleBook && !allowOverlap) {
      return { error: e.message, overlap: { staffId: d.staffId, startAt: d.startAt ?? "", customTime: d.customTime ?? "" } };
    }
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  redirect(`/app/${d.slug}?date=${instantToISODate(startAt, ctx.business.timezone)}${d.locationId ? `&location=${d.locationId}` : ""}`);
}
