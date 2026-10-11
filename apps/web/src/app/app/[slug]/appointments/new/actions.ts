"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { instantToISODate } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { bookAppointment, BookingError } from "@/server/booking";
import { createSeries } from "@/server/series";
import { notifyAppointment, scheduleReminderFor } from "@/lib/notify";
import { setFlash } from "@/lib/flash";

const schema = z.object({
  slug: z.string(),
  clientId: z.string().transform((v) => v || null),
  serviceId: z.string().min(1),
  staffId: z.string().min(1),
  startAt: z.string().datetime(),
  locationId: z.string().optional().transform((v) => v || null),
  notes: z.string().trim().max(2000).transform((v) => v || null),
  // Standing appointment: repeat every N weeks, M visits in total (including this one).
  repeatWeeks: z.coerce.number().int().min(0).max(12).default(0),
  repeatCount: z.coerce.number().int().min(2).max(52).default(6),
});

export type BookState = { error?: string } | undefined;

export async function book(_prev: BookState, formData: FormData): Promise<BookState> {
  const d = schema.parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "appointments.write.any");
  const startAt = new Date(d.startAt);
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
      // One confirmation (for the first visit) rather than one per occurrence; reminders for all.
      await notifyAppointment(ctx.business, r.created[0]!.appointmentId, "confirmation");
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
      await notifyAppointment(ctx.business, appointmentId, "confirmation");
    }
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  redirect(`/app/${d.slug}?date=${instantToISODate(startAt, ctx.business.timezone)}${d.locationId ? `&location=${d.locationId}` : ""}`);
}
