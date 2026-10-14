"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, asc, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { ensureCategory } from "@/server/categories";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { setServiceLocations } from "@/server/locations";
import { setServiceUsage } from "@/server/inventory";
import { deleteFileByUrl, FileError, uploadedImageFrom } from "@/lib/files";
import { applyServiceTerms, parseMinutesField, parsePriceField, TermError } from "@/server/stylist-pricing";

const fields = z.object({
  slug: z.string(),
  serviceId: z.string().optional(),
  name: f.text(1, 80),
  description: f.optional(300),
  prepNotes: f.optional(400),
  categoryId: z.string().optional(),
  categoryIdNew: f.optional(60),
  durationMin: f.int(5, 600),
  gapMin: f.int(0, 600),
  finishMin: f.int(0, 600),
  bufferAfterMin: f.int(0, 120),
  price: f.money("price"),
  deposit: f.moneyOptional(),
  capacity: f.int(1, 500).default(1),
  bookableOnline: f.checkbox(),
  removeImage: f.checkbox(),
});

async function imageOrFieldError(businessId: string, raw: FormData) {
  try {
    return await uploadedImageFrom(businessId, "service", raw);
  } catch (e) {
    if (e instanceof FileError) throw new FormError(e.message, "image");
    throw e;
  }
}

const revalidateServices = (slug: string, serviceId?: string) => {
  revalidatePath(`/app/${slug}/services`);
  revalidatePath(`/app/${slug}/services/all`);
  revalidatePath("/app/[slug]/services/categories/[categoryId]", "page");
  if (serviceId) revalidatePath(`/app/${slug}/services/${serviceId}`);
};

async function resolveCategory(businessId: string, d: { categoryId?: string; categoryIdNew: string | null }) {
  if (d.categoryIdNew) return ensureCategory(businessId, "service", d.categoryIdNew);
  return d.categoryId || null;
}

/** `loc_<id>` checkboxes → the "offered at" set (none/all ticked = everywhere). */
function pickedLocations(raw: FormData): string[] {
  return [...raw.keys()].filter((k) => k.startsWith("loc_")).map((k) => k.slice(4));
}

export const createService = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  const imageUrl = await imageOrFieldError(ctx.business.id, raw);
  await withTenant(ctx.business.id, async (tx) => {
    const [row] = await tx.insert(schema.services).values({
      businessId: ctx.business.id,
      categoryId,
      name: d.name,
      description: d.description,
      prepNotes: d.prepNotes,
      imageUrl,
      durationMin: d.durationMin,
      gapMin: d.gapMin,
      finishMin: d.finishMin,
      bufferAfterMin: d.bufferAfterMin,
      priceCents: d.price,
      depositCents: d.deposit,
      capacity: d.capacity,
      bookableOnline: d.bookableOnline,
    }).returning({ id: schema.services.id });
    if (raw.has("hasLocations")) await setServiceLocations(tx, ctx.business.id, row!.id, pickedLocations(raw));
  });
  await setFlash(`${d.name} added`);
  revalidateServices(d.slug);
  redirect(categoryId ? `/app/${d.slug}/services/categories/${categoryId}` : `/app/${d.slug}/services/all`);
});

export const updateService = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const categoryId = await resolveCategory(ctx.business.id, d);
  const uploaded = await imageOrFieldError(ctx.business.id, raw);
  await withTenant(ctx.business.id, async (tx) => {
    if (raw.has("hasLocations")) await setServiceLocations(tx, ctx.business.id, d.serviceId ?? "", pickedLocations(raw));
    const current = await tx.query.services.findFirst({ where: eq(schema.services.id, d.serviceId ?? ""), columns: { imageUrl: true } });
    const imagePatch = uploaded ? { imageUrl: uploaded } : d.removeImage ? { imageUrl: null } : {};
    if ((uploaded || d.removeImage) && current?.imageUrl) await deleteFileByUrl(current.imageUrl);
    await tx
      .update(schema.services)
      .set({
        ...imagePatch,
        categoryId,
        name: d.name,
        description: d.description,
        prepNotes: d.prepNotes,
        durationMin: d.durationMin,
        gapMin: d.gapMin,
        finishMin: d.finishMin,
        bufferAfterMin: d.bufferAfterMin,
        priceCents: d.price,
        depositCents: d.deposit,
        capacity: d.capacity,
        bookableOnline: d.bookableOnline,
      })
      .where(eq(schema.services.id, d.serviceId ?? ""));
  });
  revalidateServices(d.slug, d.serviceId);
  return "Service saved";
});

export async function toggleServiceActive(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const id = String(formData.get("serviceId"));
  const active = formData.get("active") === "true";
  await withTenant(ctx.business.id, (tx) => tx.update(schema.services).set({ active }).where(eq(schema.services.id, id)));
  await setFlash(active ? "Service shown again" : "Service hidden");
  revalidateServices(slug);
}

/** Move a service up/down within its category. Renumbers siblings so legacy zeros become a real order. */
export async function moveService(formData: FormData) {
  const d = z.object({ slug: z.string(), serviceId: z.string(), dir: z.enum(["up", "down"]) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await withTenant(ctx.business.id, async (tx) => {
    const me = await tx.query.services.findFirst({ where: eq(schema.services.id, d.serviceId) });
    if (!me) return;
    const siblings = await tx
      .select({ id: schema.services.id })
      .from(schema.services)
      .where(me.categoryId ? eq(schema.services.categoryId, me.categoryId) : isNull(schema.services.categoryId))
      .orderBy(asc(schema.services.sortOrder), asc(schema.services.name));
    const ids = siblings.map((s) => s.id);
    const i = ids.indexOf(me.id);
    const j = d.dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    for (let k = 0; k < ids.length; k++) await tx.update(schema.services).set({ sortOrder: k }).where(eq(schema.services.id, ids[k]!));
  });
  revalidateServices(d.slug);
}

/** From the service's own page: each stylist's price and minutes, for people who already perform it. */
export async function saveServiceStylistTerms(formData: FormData) {
  const slug = String(formData.get("slug"));
  const serviceId = String(formData.get("serviceId"));
  const ctx = await requireAction(slug, "services.manage");
  const staffIds = formData.getAll("staffIds").map(String);
  try {
    const rows = staffIds.map((staffId) => ({ staffId, price: parsePriceField(formData.get(`price_${staffId}`)), duration: parseMinutesField(formData.get(`duration_${staffId}`)) }));
    await withTenant(ctx.business.id, (tx) => applyServiceTerms(tx, serviceId, rows));
  } catch (e) {
    if (e instanceof TermError) {
      await setFlash(e.message, "error");
      return;
    }
    throw e;
  }
  await setFlash("Prices by stylist saved");
  revalidatePath(`/app/${slug}/services/${serviceId}`);
}

/** Set how many units of a product one visit of this service uses (0, or "Remove", takes it off the list). */
export async function setServiceProduct(formData: FormData) {
  const d = z.object({ slug: z.string(), serviceId: z.string().min(1), productId: z.string().min(1), quantity: z.coerce.number().int().min(0).max(1000).default(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await setServiceUsage({ businessId: ctx.business.id, serviceId: d.serviceId, productId: d.productId, quantity: formData.get("remove") ? 0 : d.quantity });
  revalidatePath(`/app/${d.slug}/services/${d.serviceId}`);
}
