"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { parseMoney } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { finalizePayroll } from "@/server/payroll";

const period = z.object({ slug: z.string(), start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function addAdjustment(formData: FormData) {
  const d = period.extend({ staffId: z.string().min(1), label: z.string().trim().min(1).max(80), amount: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "payroll.view");
  const cents = parseMoney(d.amount.replace(/^-/, ""));
  if (cents === null) throw new Error("Enter an amount like 142.90");
  const signed = d.amount.trim().startsWith("-") ? -cents : cents;
  await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.payrollAdjustments).values({ businessId: ctx.business.id, staffId: d.staffId, periodStart: d.start, periodEnd: d.end, label: d.label, amountCents: signed, createdByUserId: ctx.user.id }),
  );
  revalidatePath(`/app/${d.slug}/payroll`);
  redirect(`/app/${d.slug}/payroll?start=${d.start}&end=${d.end}`);
}

export async function deleteAdjustment(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "payroll.view");
  await withTenant(ctx.business.id, (tx) => tx.delete(schema.payrollAdjustments).where(eq(schema.payrollAdjustments.id, d.id)));
  revalidatePath(`/app/${d.slug}/payroll`);
}

export async function finalize(formData: FormData) {
  const d = period.extend({ overtime: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "payroll.view");
  await finalizePayroll(ctx.business, { start: d.start, end: d.end }, d.overtime === "on", ctx.user.id);
  revalidatePath(`/app/${d.slug}/payroll`);
}
