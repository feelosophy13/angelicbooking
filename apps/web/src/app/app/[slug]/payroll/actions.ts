"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { finalizePayroll } from "@/server/payroll";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";

export const addAdjustment = formAction(
  z.object({ slug: z.string(), start: f.isoDate(), end: f.isoDate(), staffId: f.id(), label: f.text(1, 80), amount: z.string().trim().regex(/^-?\$?\d{1,7}(\.\d{1,2})?$/, "Enter an amount like 142.90 (negative to subtract)") }),
  async (d) => {
    const ctx = await requireAction(d.slug, "payroll.view");
    const cents = Math.round(Number(d.amount.replace("$", "")) * 100);
    if (cents === 0) throw new FormError("Amount can't be zero", "amount");
    await withTenant(ctx.business.id, (tx) =>
      tx.insert(schema.payrollAdjustments).values({ businessId: ctx.business.id, staffId: d.staffId, periodStart: d.start, periodEnd: d.end, label: d.label, amountCents: cents, createdByUserId: ctx.user.id }),
    );
    await setFlash("Adjustment added");
    revalidatePath(`/app/${d.slug}/payroll`);
    redirect(`/app/${d.slug}/payroll?start=${d.start}&end=${d.end}`);
  },
);

export async function deleteAdjustment(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "payroll.view");
  await withTenant(ctx.business.id, (tx) => tx.delete(schema.payrollAdjustments).where(eq(schema.payrollAdjustments.id, d.id)));
  await setFlash("Adjustment removed");
  revalidatePath(`/app/${d.slug}/payroll`);
}

export async function finalize(formData: FormData) {
  const d = z.object({ slug: z.string(), start: f.isoDate(), end: f.isoDate(), overtime: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "payroll.view");
  await finalizePayroll(ctx.business, { start: d.start, end: d.end }, d.overtime === "on", ctx.user.id);
  await setFlash("Pay period finalized");
  revalidatePath(`/app/${d.slug}/payroll`);
}
