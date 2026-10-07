"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { deleteCategory, ensureCategory, moveCategory, renameCategory } from "@/server/categories";
import { f, formAction } from "@/lib/form";
import { setFlash } from "@/lib/flash";

const base = z.object({ slug: z.string(), kind: z.enum(["service", "product"]) });
const pathFor = (slug: string, kind: "service" | "product") => `/app/${slug}/${kind === "service" ? "services" : "products"}`;
const revalidateAll = (slug: string, kind: "service" | "product") => {
  revalidatePath(pathFor(slug, kind));
  revalidatePath(`${pathFor(slug, kind)}/categories`);
};

export const createCategory = formAction(base.extend({ name: f.text(1, 60) }), async (d) => {
  const ctx = await requireAction(d.slug, "services.manage");
  await ensureCategory(ctx.business.id, d.kind, d.name);
  await setFlash(`${d.name} added`);
  revalidateAll(d.slug, d.kind);
  redirect(`${pathFor(d.slug, d.kind)}/categories`);
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
  const d = base.extend({ id: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await deleteCategory(ctx.business.id, d.kind, d.id);
  await setFlash("Category deleted");
  revalidateAll(d.slug, d.kind);
}

export async function moveCategoryAction(formData: FormData) {
  const d = base.extend({ id: z.string().min(1), dir: z.enum(["up", "down"]) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await moveCategory(ctx.business.id, d.kind, d.id, d.dir);
  revalidateAll(d.slug, d.kind);
}
