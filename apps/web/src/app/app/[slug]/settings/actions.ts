"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/utils";

const schemaZ = z.object({
  name: z.string().trim().min(2).max(80),
  timezone: z.string().refine((t) => TIMEZONES.includes(t)),
  slotIntervalMin: z.coerce.number().int().refine((n) => [5, 10, 15, 20, 30, 60].includes(n)),
  phone: z.string().trim().max(30).transform((v) => v || null),
  email: z.string().trim().email().or(z.literal("")).transform((v) => v || null),
});

export async function updateBusiness(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "business.manage");
  const d = schemaZ.parse(Object.fromEntries(formData));
  await db.transaction(async (tx) => {
    await tx.update(schema.businesses).set(d).where(eq(schema.businesses.id, ctx.business.id));
    await tx.update(schema.organization).set({ name: d.name }).where(eq(schema.organization.id, ctx.business.id));
  });
  revalidatePath(`/app/${slug}`, "layout");
}
