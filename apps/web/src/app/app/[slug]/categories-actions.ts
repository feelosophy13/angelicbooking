"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { CategoryError, deleteCategory, ensureCategory, getServiceCategory, moveCategory, renameCategory, updateProductCategory, updateServiceCategory } from "@/server/categories";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { FileError, uploadedImageFrom } from "@/lib/files";

const base = z.object({ slug: z.string(), kind: z.enum(["service", "product"]) });
const pathFor = (slug: string, kind: "service" | "product") => `/app/${slug}/${kind === "service" ? "services" : "products"}`;
const revalidateAll = (slug: string, kind: "service" | "product") => {
  revalidatePath(pathFor(slug, kind));
  revalidatePath(`${pathFor(slug, kind)}/categories`);
  if (kind === "service") {
    revalidatePath(`${pathFor(slug, kind)}/all`);
    revalidatePath("/app/[slug]/services/categories/[categoryId]", "page");
    revalidatePath("/app/[slug]/services/categories/[categoryId]/edit", "page");
  }
};

async function imageOrFieldError(businessId: string, raw: FormData) {
  try {
    return await uploadedImageFrom(businessId, "category", raw);
  } catch (e) {
    if (e instanceof FileError) throw new FormError(e.message, "image");
    throw e;
  }
}

/** Create a category. Service categories may nest (`parentId`) and carry a description and image. */
export const createCategory = formAction(base.extend({ name: f.text(1, 60), parentId: z.string().optional(), description: f.optional(300), prepNotes: f.optional(400) }), async (d, raw) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const parentId = d.kind === "service" ? d.parentId || null : null;
  const id = await ensureCategory(ctx.business.id, d.kind, d.name, parentId);
  if (id && d.kind === "product") {
    const imageUrl = await imageOrFieldError(ctx.business.id, raw);
    if (imageUrl) await updateProductCategory(ctx.business.id, id, { name: d.name, imageUrl });
  }
  if (id && d.kind === "service") {
    const imageUrl = await imageOrFieldError(ctx.business.id, raw);
    await updateServiceCategory(ctx.business.id, id, { name: d.name, description: d.description, prepNotes: d.prepNotes, parentId, ...(imageUrl ? { imageUrl } : {}) });
  }
  await setFlash(`${d.name} added`);
  revalidateAll(d.slug, d.kind);
  redirect(d.kind === "service" ? (parentId ? `${pathFor(d.slug, d.kind)}/categories/${parentId}` : pathFor(d.slug, d.kind)) : `${pathFor(d.slug, d.kind)}/categories`);
});

/** Full edit of a service category (name, parent, description, image). */
export const updateServiceCategoryAction = formAction(
  z.object({ slug: z.string(), id: z.string().min(1), name: f.text(1, 60), parentId: z.string().optional(), description: f.optional(300), prepNotes: f.optional(400), removeImage: f.checkbox() }),
  async (d, raw) => {
    const ctx = await requireAction(d.slug, "services.manage");
    const uploaded = await imageOrFieldError(ctx.business.id, raw);
    try {
      await updateServiceCategory(ctx.business.id, d.id, { name: d.name, description: d.description, prepNotes: d.prepNotes, parentId: d.parentId || null, ...(uploaded ? { imageUrl: uploaded } : d.removeImage ? { imageUrl: null } : {}) });
    } catch (e) {
      if (e instanceof CategoryError) throw new FormError(e.message, "parentId");
      throw e;
    }
    revalidateAll(d.slug, "service");
    return "Category saved";
  },
);

/** Edit a product category: name and picture. */
export const updateProductCategoryAction = formAction(z.object({ slug: z.string(), id: z.string().min(1), name: f.text(1, 60), removeImage: f.checkbox() }), async (d, raw) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const uploaded = await imageOrFieldError(ctx.business.id, raw);
  await updateProductCategory(ctx.business.id, d.id, { name: d.name, ...(uploaded ? { imageUrl: uploaded } : d.removeImage ? { imageUrl: null } : {}) });
  revalidateAll(d.slug, "product");
  return "Category saved";
});

export async function renameCategoryAction(formData: FormData) {
  const d = base.extend({ id: z.string().min(1), name: z.string().trim().min(1).max(60) }).safeParse(Object.fromEntries(formData));
  if (!d.success) return setFlash("Enter a name", "error");
  const ctx = await requireAction(d.data.slug, "services.manage");
  await renameCategory(ctx.business.id, d.data.kind, d.data.id, d.data.name);
  await setFlash("Renamed");
  revalidateAll(d.data.slug, d.data.kind);
}

export async function removeCategory(formData: FormData) {
  const d = base.extend({ id: z.string().min(1), redirectTo: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  const parent = d.kind === "service" ? (await getServiceCategory(ctx.business.id, d.id))?.parentId : null;
  await deleteCategory(ctx.business.id, d.kind, d.id);
  await setFlash("Category deleted");
  revalidateAll(d.slug, d.kind);
  if (d.redirectTo === "browser") redirect(parent ? `${pathFor(d.slug, "service")}/categories/${parent}` : pathFor(d.slug, "service"));
}

export async function moveCategoryAction(formData: FormData) {
  const d = base.extend({ id: z.string().min(1), dir: z.enum(["up", "down"]) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await moveCategory(ctx.business.id, d.kind, d.id, d.dir);
  revalidateAll(d.slug, d.kind);
}
