"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction } from "@/lib/form";

export const saveBookingSettings = formAction(
  z.object({
    slug: z.string(),
    onlineBookingEnabled: f.checkbox(),
    requireCardOnline: f.checkbox(),
    minNoticeMin: f.int(0, 7 * 24 * 60),
    maxAdvanceDays: f.int(1, 365),
    cancelWindowHours: f.int(0, 168),
    reminderHours: f.int(1, 168),
    noShowFee: f.moneyOptional(),
    bookingPolicy: f.optional(1000),
    addressLine: f.optional(200),
  }),
  async (d) => {
    const ctx = await requireAction(d.slug, "business.manage");
    await db
      .update(schema.businesses)
      .set({
        onlineBookingEnabled: d.onlineBookingEnabled,
        requireCardOnline: d.requireCardOnline,
        minNoticeMin: d.minNoticeMin,
        maxAdvanceDays: d.maxAdvanceDays,
        cancelWindowHours: d.cancelWindowHours,
        reminderHours: d.reminderHours,
        noShowFeeCents: d.noShowFee,
        bookingPolicy: d.bookingPolicy,
        addressLine: d.addressLine,
      })
      .where(eq(schema.businesses.id, ctx.business.id));
    revalidatePath(`/app/${d.slug}/settings/booking`);
    return "Booking settings saved";
  },
);
