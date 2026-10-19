"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { auditEvent, auditSettings } from "@/lib/audit";
import { f, formAction, FormError } from "@/lib/form";

export const saveBookingSettings = formAction(
  z.object({
    slug: z.string(),
    onlineBookingEnabled: f.checkbox(),
    requireCardOnline: f.checkbox(),
    clientAccountsEnabled: f.checkbox(),
    clientPhotosOnBooking: f.checkbox(),
    minNoticeMin: f.int(0, 7 * 24 * 60),
    maxAdvanceDays: f.int(1, 365),
    bookingOrder: z.enum(["provider", "time"]).default("provider"),
    anyProviderMode: z.enum(["choose", "first", "lowest_price", "fewest_bookings"]).default("choose"),
    cancelWindowHours: f.int(0, 168),
    noShowFee: f.moneyOptional(),
    lateCancelFeeType: z.enum(["none", "flat", "percent"]).default("none"),
    lateCancelFeeValue: z.string().trim().optional(),
    lateCancelDeposit: z.enum(["toward", "extra"]).default("toward"),
    depositRefundAs: z.enum(["original", "store_credit"]).default("original"),
    bookingPolicy: f.optional(1000),
    addressLine: f.optional(200),
  }),
  async (d) => {
    const ctx = await requireAction(d.slug, "business.manage");
    const raw = Number(d.lateCancelFeeValue ?? "");
    if (d.lateCancelFeeType !== "none" && (!Number.isFinite(raw) || raw <= 0)) throw new FormError(d.lateCancelFeeType === "flat" ? "Enter the fee amount" : "Enter the percent", "lateCancelFeeValue");
    if (d.lateCancelFeeType === "percent" && raw > 100) throw new FormError("At most 100%", "lateCancelFeeValue");
    const lateCancelFeeValue = d.lateCancelFeeType === "flat" ? Math.round(raw * 100) : d.lateCancelFeeType === "percent" ? Math.round(raw * 100) : 0;
    const patch = {
        lateCancelFeeType: d.lateCancelFeeType,
        lateCancelFeeValue,
        lateCancelDeposit: d.lateCancelDeposit,
        onlineBookingEnabled: d.onlineBookingEnabled,
        requireCardOnline: d.requireCardOnline,
        clientAccountsEnabled: d.clientAccountsEnabled,
        clientPhotosOnBooking: d.clientPhotosOnBooking,
        minNoticeMin: d.minNoticeMin,
        maxAdvanceDays: d.maxAdvanceDays,
        bookingOrder: d.bookingOrder,
        anyProviderMode: d.anyProviderMode,
        cancelWindowHours: d.cancelWindowHours,
        noShowFeeCents: d.noShowFee,
        depositRefundAs: d.depositRefundAs,
        bookingPolicy: d.bookingPolicy,
        addressLine: d.addressLine,
      };
    await db.update(schema.businesses).set(patch).where(eq(schema.businesses.id, ctx.business.id));
    await auditSettings(ctx.business, ctx.user.id, "booking", patch);
    revalidatePath(`/app/${d.slug}/settings/booking`);
    return "Booking settings saved";
  },
);
