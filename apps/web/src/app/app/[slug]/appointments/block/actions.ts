"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { tzFor } from "@/server/locations";
import { blockTime, BookingError } from "@/server/booking";

export const createBlock = formAction(
  z.object({ slug: z.string(), staffId: f.id(), date: f.isoDate(), start: z.string().regex(/^\d{2}:\d{2}$/, "Pick a start time"), end: z.string().regex(/^\d{2}:\d{2}$/, "Pick an end time"), reason: f.optional(80), locationId: z.string().optional() }),
  async (d) => {
    const ctx = await requireAction(d.slug, "appointments.write.any");
    const location = d.locationId ? await withTenant(ctx.business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, d.locationId!) })) : null;
    const tz = tzFor(ctx.business, location ?? null);
    const startAt = zonedToInstant(d.date, d.start, tz);
    const endAt = zonedToInstant(d.date, d.end, tz);
    if (endAt <= startAt) throw new FormError("End must be after start", "end");
    try {
      await blockTime({ businessId: ctx.business.id, staffId: d.staffId, startAt, endAt, reason: d.reason, actorUserId: ctx.user.id, locationId: d.locationId || null });
    } catch (e) {
      if (e instanceof BookingError) throw new FormError(e.message.includes("just taken") ? "Something is already booked in that time. Move it first, or pick another time." : e.message, "start");
      throw e;
    }
    await setFlash("Time blocked");
    redirect(`/app/${d.slug}?date=${instantToISODate(startAt, tz)}${d.locationId ? `&location=${d.locationId}` : ""}`);
  },
);
