import { NextResponse, after } from "next/server";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, firstForeign, readBody, route } from "@/lib/api";
import { getSeriesApi, seriesCreate, NO_USER } from "@/server/api-v1-appointments";
import { createSeries } from "@/server/series";
import { notifyAppointment, scheduleReminderFor } from "@/lib/notify";

/**
 * POST /api/v1/series: book a standing appointment ("every N weeks, M visits"). Dates that are outside the provider's hours or already taken are
 * skipped and reported in `skipped`; 409 when none of the dates work. With notify (default true) the client gets one confirmation for the first
 * visit and reminders are scheduled for the rest, as in the staff app.
 */
export const POST = route("appointments:write", async (ctx, req) => {
  const body = await readBody(req, seriesCreate);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const missing = await withTenant(b, (tx) => firstForeign(tx, b, [[schema.clients, d.client_id, "client"], [schema.services, d.service_id, "service"], [schema.staff, d.staff_id, "staff member"], [schema.locations, d.location_id, "location"]]));
  if (missing) return ApiErrors.notFound(missing);
  const r = await createSeries({
    businessId: b, timeZone: ctx.business.timezone, slotIntervalMin: ctx.business.slotIntervalMin, clientId: d.client_id ?? null, serviceId: d.service_id, staffId: d.staff_id,
    firstStartAt: new Date(d.start_at), intervalWeeks: d.interval_weeks, occurrences: d.occurrences, notes: d.notes || null, createdByUserId: NO_USER, locationId: d.location_id ?? null,
  });
  await apiAudit(ctx, "api.series.create", "appointment_series", r.seriesId, { serviceId: d.service_id, staffId: d.staff_id, intervalWeeks: d.interval_weeks, created: r.created.length, skipped: r.skipped.length });
  if (d.notify) {
    after(async () => {
      try {
        await notifyAppointment(ctx.business, r.created[0]!.appointmentId, "confirmation");
        for (const c of r.created.slice(1)) await scheduleReminderFor(ctx.business, c.appointmentId);
      } catch (e) {
        console.error("[api/v1] notify failed", (e as Error).message);
      }
    });
  }
  return NextResponse.json({ data: { ...(await getSeriesApi(b, r.seriesId)), skipped: r.skipped.map((s) => ({ start_at: s.startAt.toISOString(), reason: s.reason })) } }, { status: 201 });
});
