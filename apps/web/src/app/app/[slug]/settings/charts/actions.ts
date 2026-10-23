"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { CHART_DISPLAY_TYPES, parseChartFieldRows, starterChartTemplate } from "@angelic/core";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { auditEvent } from "@/lib/audit";

const fields = z.object({ slug: z.string(), templateId: z.string().optional(), starterKey: z.string().optional(), name: f.text(1, 120), description: f.optional(2000), active: f.checkbox() });

async function parse(tx: TenantDb, raw: FormData) {
  const rawObj: Record<string, string> = {};
  for (const [k, v] of raw.entries()) if (typeof v === "string") rawObj[k] = v;
  const defs = parseChartFieldRows(rawObj);
  if (!defs.some((d) => !CHART_DISPLAY_TYPES.includes(d.type))) throw new FormError("Add at least one field to fill in.");
  const posted = [...new Set(raw.getAll("serviceIds").map(String).filter(Boolean))];
  // Only this business's services (RLS hides the rest).
  const serviceIds = posted.length ? (await tx.select({ id: schema.services.id }).from(schema.services).where(inArray(schema.services.id, posted))).map((s) => s.id) : [];
  return { defs, serviceIds };
}

// Chart templates are designed by whoever designs the forms (forms.manage); reading and writing charts are the charts permissions.
export const createChartTemplate = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "forms.manage");
  const id = await withTenant(ctx.business.id, async (tx) => {
    const { defs, serviceIds } = await parse(tx, raw);
    const [row] = await tx.insert(schema.chartTemplates).values({ businessId: ctx.business.id, name: d.name, description: d.description, fields: defs, serviceIds, starterKey: starterChartTemplate(d.starterKey) ? d.starterKey! : null, active: true }).returning({ id: schema.chartTemplates.id });
    return row!.id;
  });
  await auditEvent(ctx.business.id, ctx.user.id, "chart.template.create", "chart_template", id, { name: d.name });
  await setFlash(`${d.name} added`);
  revalidatePath(`/app/${d.slug}/settings/charts`);
  redirect(`/app/${d.slug}/settings/charts`);
});

export const updateChartTemplate = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "forms.manage");
  await withTenant(ctx.business.id, async (tx) => {
    const { defs, serviceIds } = await parse(tx, raw);
    const done = await tx.update(schema.chartTemplates).set({ name: d.name, description: d.description, fields: defs, serviceIds, active: d.active, updatedAt: new Date() }).where(eq(schema.chartTemplates.id, d.templateId ?? "")).returning({ id: schema.chartTemplates.id });
    if (!done.length) throw new FormError("This template was deleted.");
  });
  await auditEvent(ctx.business.id, ctx.user.id, "chart.template.update", "chart_template", d.templateId ?? null, { name: d.name });
  revalidatePath(`/app/${d.slug}/settings/charts`);
  return "Template saved";
});

/** Delete a template nobody has charted on yet; one with charts is switched off instead (the charts keep their own copy anyway). */
export async function deleteChartTemplate(formData: FormData) {
  const d = z.object({ slug: z.string(), templateId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "forms.manage");
  const used = await withTenant(ctx.business.id, async (tx) => {
    const hit = await tx.query.chartNotes.findFirst({ where: eq(schema.chartNotes.templateId, d.templateId), columns: { id: true } });
    if (hit) await tx.update(schema.chartTemplates).set({ active: false }).where(eq(schema.chartTemplates.id, d.templateId));
    else await tx.delete(schema.chartTemplates).where(and(eq(schema.chartTemplates.id, d.templateId)));
    return !!hit;
  });
  await auditEvent(ctx.business.id, ctx.user.id, used ? "chart.template.archive" : "chart.template.delete", "chart_template", d.templateId);
  await setFlash(used ? "Template switched off (charts written on it are kept)" : "Template deleted");
  revalidatePath(`/app/${d.slug}/settings/charts`);
  redirect(`/app/${d.slug}/settings/charts`);
}
