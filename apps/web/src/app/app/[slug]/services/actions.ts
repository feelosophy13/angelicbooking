"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";

const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter a price like 45 or 45.50").transform((v) => Math.round(Number(v) * 100));
const minutes = (min: number) => z.coerce.number().int().min(min).max(600);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  categoryName: z.string().trim().max(60),
  durationMin: minutes(5),
  gapMin: minutes(0),
  finishMin: minutes(0),
  bufferAfterMin: minutes(0),
  price: money,
  deposit: money.or(z.literal("").transform(() => 0)),
});

export async function createService(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const d = createSchema.parse(Object.fromEntries(formData));
  await withTenant(ctx.business.id, async (tx) => {
    let categoryId: string | null = null;
    if (d.categoryName) {
      const existing = await tx.query.serviceCategories.findFirst({ where: eq(schema.serviceCategories.name, d.categoryName) });
      if (existing) categoryId = existing.id;
      else {
        const [c] = await tx.insert(schema.serviceCategories).values({ businessId: ctx.business.id, name: d.categoryName }).returning({ id: schema.serviceCategories.id });
        categoryId = c!.id;
      }
    }
    await tx.insert(schema.services).values({
      businessId: ctx.business.id,
      categoryId,
      name: d.name,
      durationMin: d.durationMin,
      gapMin: d.gapMin,
      finishMin: d.finishMin,
      bufferAfterMin: d.bufferAfterMin,
      priceCents: d.price,
      depositCents: d.deposit,
    });
  });
  revalidatePath(`/app/${slug}/services`);
}

export async function toggleServiceActive(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const id = String(formData.get("serviceId"));
  const active = formData.get("active") === "true";
  await withTenant(ctx.business.id, (tx) => tx.update(schema.services).set({ active }).where(eq(schema.services.id, id)));
  revalidatePath(`/app/${slug}/services`);
}
