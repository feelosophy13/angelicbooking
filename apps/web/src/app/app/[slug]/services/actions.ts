"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { ensureCategory } from "@/server/categories";

const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter a price like 45 or 45.50").transform((v) => Math.round(Number(v) * 100));
const minutes = (min: number) => z.coerce.number().int().min(min).max(600);

const fields = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  categoryId: z.string().optional(),
  categoryIdNew: z.string().trim().max(60).optional(),
  durationMin: minutes(5),
  gapMin: minutes(0),
  finishMin: minutes(0),
  bufferAfterMin: minutes(0),
  price: money,
  deposit: money.or(z.literal("").transform(() => 0)),
  bookableOnline: z.string().optional(),
});

async function resolveCategory(businessId: string, d: { categoryId?: string; categoryIdNew?: string }) {
  if (d.categoryIdNew) return ensureCategory(businessId, "service", d.categoryIdNew);
  return d.categoryId || null;
}

export async function createService(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const d = fields.parse(Object.fromEntries(formData));
  const categoryId = await resolveCategory(ctx.business.id, d);
  await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.services).values({
      businessId: ctx.business.id,
      categoryId,
      name: d.name,
      description: d.description || null,
      durationMin: d.durationMin,
      gapMin: d.gapMin,
      finishMin: d.finishMin,
      bufferAfterMin: d.bufferAfterMin,
      priceCents: d.price,
      depositCents: d.deposit,
      bookableOnline: d.bookableOnline !== "off",
    }),
  );
  revalidatePath(`/app/${slug}/services`);
  redirect(`/app/${slug}/services`);
}

export async function updateService(formData: FormData) {
  const slug = String(formData.get("slug"));
  const serviceId = String(formData.get("serviceId"));
  const ctx = await requireAction(slug, "services.manage");
  const d = fields.parse(Object.fromEntries(formData));
  const categoryId = await resolveCategory(ctx.business.id, d);
  await withTenant(ctx.business.id, (tx) =>
    tx
      .update(schema.services)
      .set({
        categoryId,
        name: d.name,
        description: d.description || null,
        durationMin: d.durationMin,
        gapMin: d.gapMin,
        finishMin: d.finishMin,
        bufferAfterMin: d.bufferAfterMin,
        priceCents: d.price,
        depositCents: d.deposit,
        bookableOnline: d.bookableOnline === "on",
      })
      .where(eq(schema.services.id, serviceId)),
  );
  revalidatePath(`/app/${slug}/services`);
  revalidatePath(`/app/${slug}/services/${serviceId}`);
}

export async function toggleServiceActive(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const id = String(formData.get("serviceId"));
  const active = formData.get("active") === "true";
  await withTenant(ctx.business.id, (tx) => tx.update(schema.services).set({ active }).where(eq(schema.services.id, id)));
  revalidatePath(`/app/${slug}/services`);
}
