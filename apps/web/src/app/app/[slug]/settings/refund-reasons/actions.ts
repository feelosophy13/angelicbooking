"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { formAction } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { createRefundReason, moveRefundReason, renameRefundReason, RefundReasonError, setRefundReasonActive } from "@/server/refund-reasons";

const reasonBase = z.object({ slug: z.string() });

export const addRefundReason = formAction(reasonBase.extend({ name: z.string().trim().min(1, "Enter a reason").max(60) }), async (d) => {
  const ctx = await requireAction(d.slug, "settings.business");
  await createRefundReason(ctx.business.id, d.name);
  revalidatePath(`/app/${d.slug}/settings/refund-reasons`);
  return "Reason added";
});

export const renameRefundReasonAction = formAction(reasonBase.extend({ id: z.string().min(1), name: z.string().trim().min(1, "Enter a reason").max(60) }), async (d) => {
  const ctx = await requireAction(d.slug, "settings.business");
  await renameRefundReason(ctx.business.id, d.id, d.name);
  revalidatePath(`/app/${d.slug}/settings/refund-reasons`);
  return "Reason renamed";
});

export async function setRefundReasonActiveAction(formData: FormData) {
  const d = reasonBase.extend({ id: z.string().min(1), active: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "settings.business");
  try {
    await setRefundReasonActive(ctx.business.id, d.id, d.active === "1");
    await setFlash(d.active === "1" ? "Reason restored" : "Reason retired");
  } catch (e) {
    if (e instanceof RefundReasonError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${d.slug}/settings/refund-reasons`);
}

export async function moveRefundReasonAction(formData: FormData) {
  const d = reasonBase.extend({ id: z.string().min(1), dir: z.enum(["up", "down"]) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "settings.business");
  await moveRefundReason(ctx.business.id, d.id, d.dir);
  revalidatePath(`/app/${d.slug}/settings/refund-reasons`);
}
