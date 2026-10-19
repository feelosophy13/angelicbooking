"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { formAction } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { createCancellationReason, moveCancellationReason, renameCancellationReason, CancellationReasonError, setCancellationReasonActive, setCancellationReasonClientVisible } from "@/server/cancellation-reasons";

const reasonBase = z.object({ slug: z.string() });

export const addCancellationReason = formAction(reasonBase.extend({ name: z.string().trim().min(1, "Enter a reason").max(60) }), async (d) => {
  const ctx = await requireAction(d.slug, "settings.business");
  await createCancellationReason(ctx.business.id, d.name);
  revalidatePath(`/app/${d.slug}/settings/cancellation-reasons`);
  return "Reason added";
});

export const renameCancellationReasonAction = formAction(reasonBase.extend({ id: z.string().min(1), name: z.string().trim().min(1, "Enter a reason").max(60) }), async (d) => {
  const ctx = await requireAction(d.slug, "settings.business");
  await renameCancellationReason(ctx.business.id, d.id, d.name);
  revalidatePath(`/app/${d.slug}/settings/cancellation-reasons`);
  return "Reason renamed";
});

export async function setCancellationReasonActiveAction(formData: FormData) {
  const d = reasonBase.extend({ id: z.string().min(1), active: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "settings.business");
  try {
    await setCancellationReasonActive(ctx.business.id, d.id, d.active === "1");
    await setFlash(d.active === "1" ? "Reason restored" : "Reason retired");
  } catch (e) {
    if (e instanceof CancellationReasonError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${d.slug}/settings/cancellation-reasons`);
}

export async function moveCancellationReasonAction(formData: FormData) {
  const d = reasonBase.extend({ id: z.string().min(1), dir: z.enum(["up", "down"]) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "settings.business");
  await moveCancellationReason(ctx.business.id, d.id, d.dir);
  revalidatePath(`/app/${d.slug}/settings/cancellation-reasons`);
}

export async function setCancellationReasonClientVisibleAction(formData: FormData) {
  const d = reasonBase.extend({ id: z.string().min(1), visible: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "settings.business");
  await setCancellationReasonClientVisible(ctx.business.id, d.id, d.visible === "1");
  revalidatePath(`/app/${d.slug}/settings/cancellation-reasons`);
}
