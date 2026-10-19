"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction, requireAnyAction } from "@/lib/tenant";
import { finalizePayroll, getFinalizedRunIn, markPayrollPaid, unmarkPayrollPaid } from "@/server/payroll";
import { PayrollLockedError } from "@/server/payroll-lock";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { auditSettings } from "@/lib/audit";

export const addAdjustment = formAction(
  z.object({ slug: z.string(), start: f.isoDate(), end: f.isoDate(), staffId: f.id(), label: f.text(1, 80), amount: z.string().trim().regex(/^-?\$?\d{1,7}(\.\d{1,2})?$/, "Enter an amount like 142.90 (negative to subtract)"), countsAsPay: f.checkbox() }),
  async (d) => {
    const ctx = await requireAction(d.slug, "payroll.manage");
    const cents = Math.round(Number(d.amount.replace("$", "")) * 100);
    if (cents === 0) throw new FormError("Amount can't be zero", "amount");
    await withTenant(ctx.business.id, async (tx) => {
      if (await getFinalizedRunIn(tx, { start: d.start, end: d.end })) throw new FormError("This period is finalized. Add the adjustment to the current period instead.", "label");
      const [row] = await tx.insert(schema.payrollAdjustments).values({ businessId: ctx.business.id, staffId: d.staffId, periodStart: d.start, periodEnd: d.end, label: d.label, amountCents: cents, countsAsPay: d.countsAsPay, createdByUserId: ctx.user.id }).returning();
      await tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "payroll.adjustment_add", entity: "payroll_adjustment", entityId: row!.id, diff: JSON.stringify({ staffId: d.staffId, period: `${d.start}_${d.end}`, label: d.label, cents }) });
    });
    await setFlash("Adjustment added");
    revalidatePath(`/app/${d.slug}/payroll`);
    redirect(`/app/${d.slug}/payroll?start=${d.start}&end=${d.end}`);
  },
);

export async function deleteAdjustment(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "payroll.manage");
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
  const ctx = await requireAction(d.slug, "payroll.manage");
  try {
    await finalizePayroll(ctx.business, { start: d.start, end: d.end }, d.overtime === "on", ctx.user.id);
  } catch (e) {
    // Two finalized periods sharing a day would pay those days twice; say which one is in the way.
    if (e instanceof PayrollLockedError) return setFlash(e.message, "error");
    throw e;
  }
  await setFlash("Pay period finalized");
  revalidatePath(`/app/${d.slug}/payroll`);
}

/** "Mark as paid": the day the checks went out and a check or batch reference, on a finalized period. Locks re-finalize until unmarked. */
export async function markPaid(formData: FormData) {
  const d = z.object({ slug: z.string(), start: f.isoDate(), end: f.isoDate(), paidOn: f.isoDate(), paymentRef: f.optional(80) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "payroll.manage");
  try {
    await markPayrollPaid(ctx.business, { start: d.start, end: d.end }, { paidOn: d.paidOn, paymentRef: d.paymentRef }, ctx.user.id);
  } catch (e) {
    if (e instanceof PayrollLockedError) return setFlash(e.message, "error");
    throw e;
  }
  await setFlash("Marked as paid");
  revalidatePath(`/app/${d.slug}/payroll`);
}

export async function unmarkPaid(formData: FormData) {
  const d = z.object({ slug: z.string(), start: f.isoDate(), end: f.isoDate() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "payroll.manage");
  await unmarkPayrollPaid(ctx.business, { start: d.start, end: d.end }, ctx.user.id);
  await setFlash("No longer marked as paid");
  revalidatePath(`/app/${d.slug}/payroll`);
}

/**
 * The pay schedule (weekly / biweekly / semimonthly / monthly, an anchor day for the first two) and the shared week start. Saved from
 * Payroll → Options or Settings → Payroll rules; anyone who runs payroll or edits booking-and-money rules may set it.
 */
export const savePaySchedule = formAction(
  z.object({ slug: z.string(), frequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]), anchor: z.string().trim().optional(), weekStart: z.coerce.number().int().refine((n) => [0, 1, 6].includes(n), "Pick a day"), back: z.string().startsWith("/app/").optional() }),
  async (d) => {
    const ctx = await requireAnyAction(d.slug, "payroll.manage", "settings.booking");
    const anchored = d.frequency === "weekly" || d.frequency === "biweekly";
    if (anchored && !/^\d{4}-\d{2}-\d{2}$/.test(d.anchor ?? "")) throw new FormError("Pick the first day of any pay period", "anchor");
    const patch = { payFrequency: d.frequency, payAnchorDate: anchored ? d.anchor! : null, weekStart: d.weekStart };
    await withTenant(ctx.business.id, (tx) => tx.update(schema.businesses).set(patch).where(eq(schema.businesses.id, ctx.business.id)));
    await auditSettings(ctx.business, ctx.user.id, "payroll", patch);
    revalidatePath(`/app/${d.slug}`, "layout");
    if (d.back) {
      await setFlash("Pay schedule saved");
      redirect(d.back);
    }
    return "Pay schedule saved";
  },
);

/** How overtime is counted when a run has it on: federal weekly, or California daily. A business-wide setting. */
export async function setOvertimeRule(formData: FormData) {
  const d = z.object({ slug: z.string(), rule: z.enum(["weekly", "daily"]), back: z.string().startsWith("/app/") }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "payroll.manage");
  await withTenant(ctx.business.id, async (tx) => {
    await tx.update(schema.businesses).set({ overtimeRule: d.rule }).where(eq(schema.businesses.id, ctx.business.id));
    await tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "payroll.overtime_rule", entity: "business", entityId: ctx.business.id, diff: JSON.stringify({ from: ctx.business.overtimeRule, to: d.rule }) });
  });
  await setFlash(d.rule === "daily" ? "Overtime counted daily (California)" : "Overtime counted weekly");
  revalidatePath(`/app/${d.slug}/payroll`);
  redirect(d.back);
}

/** Commission rules: who absorbs discounts, the provider's share of no-show and late fees, and the package redemption base. */
export const savePayrollRules = formAction(
  z.object({ slug: z.string(), discountAbsorb: z.enum(["provider", "house", "split"]), feeSharePct: z.coerce.number({ message: "Enter a percent" }).min(0, "At least 0").max(100, "At most 100"), packageRedemptionBase: z.enum(["list", "package_share"]) }),
  async (d) => {
    const ctx = await requireAnyAction(d.slug, "payroll.manage", "settings.booking");
    const patch = { discountAbsorb: d.discountAbsorb, feeShareBps: Math.round(d.feeSharePct * 100), packageRedemptionBase: d.packageRedemptionBase };
    await withTenant(ctx.business.id, (tx) => tx.update(schema.businesses).set(patch).where(eq(schema.businesses.id, ctx.business.id)));
    await auditSettings(ctx.business, ctx.user.id, "payroll", patch);
    revalidatePath(`/app/${d.slug}`, "layout");
    return "Commission rules saved";
  },
);
