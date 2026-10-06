"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { deleteCategory, ensureCategory, moveCategory, renameCategory } from "@/server/categories";

const base = z.object({ slug: z.string(), kind: z.enum(["service", "product"]) });
const pathFor = (slug: string, kind: "service" | "product") => `/app/${slug}/${kind === "service" ? "services" : "products"}`;

export async function createCategory(formData: FormData) {
  const d = base.extend({ name: z.string().trim().min(1).max(60) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await ensureCategory(ctx.business.id, d.kind, d.name);
  revalidatePath(pathFor(d.slug, d.kind));
}

export async function renameCategoryAction(formData: FormData) {
  const d = base.extend({ id: z.string().min(1), name: z.string().trim().min(1).max(60) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await renameCategory(ctx.business.id, d.kind, d.id, d.name);
  revalidatePath(pathFor(d.slug, d.kind));
}

export async function removeCategory(formData: FormData) {
  const d = base.extend({ id: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await deleteCategory(ctx.business.id, d.kind, d.id);
  revalidatePath(pathFor(d.slug, d.kind));
}

export async function moveCategoryAction(formData: FormData) {
  const d = base.extend({ id: z.string().min(1), dir: z.enum(["up", "down"]) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await moveCategory(ctx.business.id, d.kind, d.id, d.dir);
  revalidatePath(pathFor(d.slug, d.kind));
}
