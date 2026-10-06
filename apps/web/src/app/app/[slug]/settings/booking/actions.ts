"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { parseMoney } from "@angelic/core";
import { requireAction } from "@/lib/tenant";

const schemaZ = z.object({
  onlineBookingEnabled: z.string().optional(),
  requireCardOnline: z.string().optional(),
  minNoticeMin: z.coerce.number().int().min(0).max(7 * 24 * 60),
  maxAdvanceDays: z.coerce.number().int().min(1).max(365),
  cancelWindowHours: z.coerce.number().int().min(0).max(168),
  reminderHours: z.coerce.number().int().min(1).max(168),
  noShowFee: z.string().optional(),
  bookingPolicy: z.string().trim().max(1000),
  addressLine: z.string().trim().max(200),
});

export async function saveBookingSettings(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business } = await requireAction(slug, "business.manage");
  const d = schemaZ.parse(Object.fromEntries(formData));
  const fee = parseMoney(d.noShowFee ?? "") ?? 0;
  await db
    .update(schema.businesses)
    .set({
      onlineBookingEnabled: d.onlineBookingEnabled === "on",
      requireCardOnline: d.requireCardOnline === "on",
      minNoticeMin: d.minNoticeMin,
      maxAdvanceDays: d.maxAdvanceDays,
      cancelWindowHours: d.cancelWindowHours,
      reminderHours: d.reminderHours,
      noShowFeeCents: fee,
      bookingPolicy: d.bookingPolicy || null,
      addressLine: d.addressLine || null,
    })
    .where(eq(schema.businesses.id, business.id));
  revalidatePath(`/app/${slug}/settings/booking`);
}
