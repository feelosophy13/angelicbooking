"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { auditEvent, auditSettings } from "@/lib/audit";
import { formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { disableCheckin, enableCheckin, resetCheckin } from "@/server/checkin-kiosk";

/** How early a client may check themselves in: 0 to 4 hours before the appointment. */
export const saveCheckinWindow = formAction(z.object({ slug: z.string(), early: z.string().trim() }), async (d) => {
  const ctx = await requireAction(d.slug, "settings.business");
  const n = Number(d.early);
  if (!Number.isInteger(n) || n < 0 || n > 240) throw new FormError("Whole minutes from 0 to 240", "early");
  await db.update(schema.businesses).set({ checkinEarlyMinutes: n }).where(eq(schema.businesses.id, ctx.business.id));
  await auditSettings(ctx.business, ctx.user.id, "checkin", { checkinEarlyMinutes: n });
  revalidatePath(`/app/${d.slug}/settings/check-in`);
  return "Check-in window saved";
});

/** Turn the kiosk on or off for a location, or give it a new address (unpairs the tablet holding the old one). */
export async function changeKiosk(formData: FormData) {
  const d = z.object({ slug: z.string(), locationId: z.string().min(1), op: z.enum(["on", "off", "reset"]) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "settings.business");
  if (d.op === "on") await enableCheckin(ctx.business.id, d.locationId);
  else if (d.op === "off") await disableCheckin(ctx.business.id, d.locationId);
  else await resetCheckin(ctx.business.id, d.locationId);
  await auditEvent(ctx.business.id, ctx.user.id, `settings.checkin_${d.op}`, "location", d.locationId);
  await setFlash(d.op === "on" ? "Check-in kiosk turned on" : d.op === "off" ? "Check-in kiosk turned off. The tablet now shows nothing." : "New kiosk link made. The old link stopped working; open the new one on the tablet.");
  revalidatePath(`/app/${d.slug}/settings/check-in`);
  revalidatePath(`/app/${d.slug}`, "layout");
}
