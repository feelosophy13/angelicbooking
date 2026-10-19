"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/utils";
import { auditEvent, auditSettings } from "@/lib/audit";
import { f, formAction } from "@/lib/form";

export const updateBusiness = formAction(
  z.object({
    slug: z.string(),
    name: f.text(2, 80),
    timezone: z.string().refine((t) => TIMEZONES.includes(t), "Pick a timezone"),
    slotIntervalMin: z.coerce.number().int().refine((n) => [5, 10, 15, 20, 30, 60].includes(n), "Pick an interval"),
    weekStart: z.coerce.number().int().refine((n) => [0, 1, 6].includes(n), "Pick a day").default(1),
    phone: f.optional(30),
    email: f.email(),
  }),
  async (d) => {
    const ctx = await requireAction(d.slug, "business.manage");
    await db.transaction(async (tx) => {
      await tx.update(schema.businesses).set({ name: d.name, timezone: d.timezone, slotIntervalMin: d.slotIntervalMin, weekStart: d.weekStart, phone: d.phone, email: d.email }).where(eq(schema.businesses.id, ctx.business.id));
      await tx.update(schema.organization).set({ name: d.name }).where(eq(schema.organization.id, ctx.business.id));
    });
    await auditSettings(ctx.business, ctx.user.id, "business", { name: d.name, timezone: d.timezone, slotIntervalMin: d.slotIntervalMin, weekStart: d.weekStart, phone: d.phone, email: d.email });
    revalidatePath(`/app/${d.slug}`, "layout");
    return "Settings saved";
  },
);
