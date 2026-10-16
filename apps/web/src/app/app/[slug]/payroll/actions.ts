"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { finalizePayroll, getFinalizedRunIn } from "@/server/payroll";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";

export const addAdjustment = formAction(
  z.object({ slug: z.string(), start: f.isoDate(), end: f.isoDate(), staffId: f.id(), label: f.text(1, 80), amount: z.string().trim().regex(/^-?\$?\d{1,7}(\.\d{1,2})?$/, "Enter an amount like 142.90 (negative to subtract)") }),
  async (d) => {
    const ctx = await requireAction(d.slug, "payroll.view");
    const cents = Math.round(Number(d.amount.replace("$", "")) * 100);
    if (cents === 0) throw new FormError("Amount can't be zero", "amount");
    await withTenant(ctx.business.id, async (tx) => {
      if (await getFinalizedRunIn(tx, { start: d.start, end: d.end })) throw new FormError("This period is finalized. Add the adjustment to the current period instead.", "label");
      const [row] = await tx.insert(schema.payrollAdjustments).values({ businessId: ctx.business.id, staffId: d.staffId, periodStart: d.start, periodEnd: d.end, label: d.label, amountCents: cents, createdByUserId: ctx.user.id }).returning();
      await tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "payroll.adjustment_add", entity: "payroll_adjustment", entityId: row!.id, diff: JSON.stringify({ staffId: d.staffId, period: `${d.start}_${d.end}`, label: d.label, cents }) });
    });
    await setFlash("Adjustment added");
    revalidatePath(`/app/${d.slug}/payroll`);
    redirect(`/app/${d.slug}/payroll?start=${d.start}&end=${d.end}`);
  },
);

export async function deleteAdjustment(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "payroll.view");
  const outcome = await withTenant(ctx.business.id, async (tx) => {
    const a = await tx.query.payrollAdjustments.findFirst({ where: eq(schema.payrollAdjustments.id, d.id) });
    if (!a) return "gone";
    if (await getFinalizedRunIn(tx, { start: a.periodStart, end: a.periodEnd })) return "locked";
    await tx.delete(schema.payrollAdjustments).where(eq(schema.payrollAdjustments.id, a.id));
    await tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "payroll.adjustment_remove", entity: "payroll_adjustment", entityId: a.id, diff: JSON.stringify({ staffId: a.staffId, period: `${a.periodStart}_${a.periodEnd}`, label: a.label, cents: a.amountCents }) });
    return "ok";
  });
  if (outcome === "locked") {
    await setFlash("This period is finalized, so its adjustments can't be removed. Add a correcting adjustment to the current period.", "error");
    return;
  }
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

/** How overtime is counted when a run has it on: federal weekly, or California daily. A business-wide setting. */
export async function setOvertimeRule(formData: FormData) {
  const d = z.object({ slug: z.string(), rule: z.enum(["weekly", "daily"]), back: z.string().startsWith("/app/") }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "payroll.view");
  await withTenant(ctx.business.id, async (tx) => {
    await tx.update(schema.businesses).set({ overtimeRule: d.rule }).where(eq(schema.businesses.id, ctx.business.id));
    await tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "payroll.overtime_rule", entity: "business", entityId: ctx.business.id, diff: JSON.stringify({ from: ctx.business.overtimeRule, to: d.rule }) });
  });
  await setFlash(d.rule === "daily" ? "Overtime counted daily (California)" : "Overtime counted weekly");
  revalidatePath(`/app/${d.slug}/payroll`);
  redirect(d.back);
}
