"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { FillError, sendFillInvites } from "@/server/fill-books";

/** Send: invite the ticked clients to one opening. The server re-checks who it would suggest, consent, the caps and the slot. */
export const sendFillAction = formAction(z.object({ slug: z.string(), staffId: f.id(), start: z.string().datetime(), locationId: z.string().optional() }), async (d, formData) => {
  const ctx = await requireAction(d.slug, "marketing.send");
  const clientIds = formData.getAll("clientId").filter((v): v is string => typeof v === "string" && !!v);
  if (!clientIds.length) throw new FormError("Tick at least one client to invite.");
  const r = await sendFillInvites(ctx.business, { staffId: d.staffId, start: new Date(d.start), locationId: d.locationId || null, clientIds }, ctx.user.id);
  revalidatePath(`/app/${d.slug}/marketing/fill`);
  const msg = `Invited ${r.sent} client${r.sent === 1 ? "" : "s"}`;
  return r.skipped.length ? `${msg}. Not sent: ${r.skipped.join("; ")}` : msg;
}, { knownErrors: [FillError] });

export const saveFillSettings = formAction(
  z.object({
    slug: z.string(),
    fillAutoEnabled: f.checkbox(),
    fillAutoHour: f.int(8, 18),
    fillDaysAhead: f.int(1, 14),
    fillMaxPerSlot: f.int(1, 10),
    fillMaxPerDay: f.int(1, 200),
    fillMessage: f.optional(320),
  }),
  async (d) => {
    const ctx = await requireAction(d.slug, "marketing.send");
    if (d.fillMessage && !d.fillMessage.includes("{link}")) throw new FormError("Keep {link} in the message: it's the one-tap booking link.", "fillMessage");
    await db
      .update(schema.businesses)
      .set({ fillAutoEnabled: d.fillAutoEnabled, fillAutoHour: d.fillAutoHour, fillDaysAhead: d.fillDaysAhead, fillMaxPerSlot: d.fillMaxPerSlot, fillMaxPerDay: d.fillMaxPerDay, fillMessage: d.fillMessage })
      .where(eq(schema.businesses.id, ctx.business.id));
    await withTenant(ctx.business.id, (tx) => tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "fill.settings", entity: "business", entityId: ctx.business.id, diff: JSON.stringify({ auto: d.fillAutoEnabled, hour: d.fillAutoHour, perSlot: d.fillMaxPerSlot, perDay: d.fillMaxPerDay }) }));
    revalidatePath(`/app/${d.slug}/marketing/fill`);
    return "Settings saved";
  },
);
