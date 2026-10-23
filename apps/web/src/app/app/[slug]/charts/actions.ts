"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ChartError, chartAnswersFromForm, type ChartFieldDef } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { requireAnyAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { auditEvent } from "@/lib/audit";
import { addAddendum, chartPhotos, createChart, deleteDraft, fieldsForNew, saveChart } from "@/server/charts";

const WRITE = ["charts.write.own", "charts.write.any"] as const;
const opt = z.string().optional().transform((v) => v || null);

/** Chart errors are worded for people; show them under the field they are about. */
async function charting<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ChartError) throw new FormError(e.message, e.field ?? undefined);
    throw e;
  }
}

const answersFrom = (fields: ChartFieldDef[], raw: FormData, photoIds: string[]) =>
  chartAnswersFromForm(fields, (n) => { const v = raw.get(n); return typeof v === "string" ? v : null; }, (n) => raw.getAll(n).map(String), new Set(photoIds));

const newSchema = z.object({ slug: z.string(), clientId: f.id(), appointmentId: opt, serviceId: opt, template: z.string().min(1, "Choose a chart template"), intent: z.enum(["draft", "sign"]).default("draft") });

/** Start a chart: saved as a draft, or signed at once. Nothing is stored until this first save. */
export const createChartAction = formAction(newSchema, async (d, raw) => {
  const ctx = await requireAnyAction(d.slug, ...WRITE);
  const id = await charting(() =>
    withTenant(ctx.business.id, async (tx) => {
      const fields = await fieldsForNew(tx, d.template);
      const photos = (await chartPhotos(tx, d.appointmentId)).map((p) => p.id);
      return createChart(tx, ctx.business.id, ctx, { clientId: d.clientId, appointmentId: d.appointmentId, serviceId: d.serviceId, template: d.template, answers: answersFrom(fields, raw, photos), sign: d.intent === "sign" });
    }),
  );
  await auditEvent(ctx.business.id, ctx.user.id, d.intent === "sign" ? "chart.sign" : "chart.create", "chart", id, { clientId: d.clientId, appointmentId: d.appointmentId });
  await setFlash(d.intent === "sign" ? "Chart signed" : "Draft saved");
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}/charts`);
  if (d.appointmentId) revalidatePath(`/app/${d.slug}/appointments/${d.appointmentId}`);
  redirect(`/app/${d.slug}/charts/${id}`);
});

const saveSchema = z.object({ slug: z.string(), noteId: f.id(), intent: z.enum(["draft", "sign"]).default("draft") });

/** Save a draft's answers, or sign it. Signing locks it. */
export const saveChartAction = formAction(saveSchema, async (d, raw) => {
  const ctx = await requireAnyAction(d.slug, ...WRITE);
  const note = await charting(() =>
    withTenant(ctx.business.id, async (tx) => {
      const cur = await tx.query.chartNotes.findFirst({ where: eq(schema.chartNotes.id, d.noteId), columns: { templateSnapshot: true, appointmentId: true } });
      if (!cur) throw new ChartError("This chart was deleted.");
      const photos = (await chartPhotos(tx, cur.appointmentId)).map((p) => p.id);
      return saveChart(tx, ctx, d.noteId, answersFrom(cur.templateSnapshot.fields as ChartFieldDef[], raw, photos), d.intent === "sign");
    }),
  );
  await auditEvent(ctx.business.id, ctx.user.id, d.intent === "sign" ? "chart.sign" : "chart.save", "chart", note.id, { clientId: note.clientId });
  revalidatePath(`/app/${d.slug}/charts/${note.id}`);
  revalidatePath(`/app/${d.slug}/clients/${note.clientId}/charts`);
  if (note.appointmentId) revalidatePath(`/app/${d.slug}/appointments/${note.appointmentId}`);
  if (d.intent === "sign") {
    await setFlash("Chart signed");
    redirect(`/app/${d.slug}/charts/${note.id}`);
  }
  return "Draft saved";
});

const addendumSchema = z.object({ slug: z.string(), noteId: f.id(), body: z.string().max(5000) });

/** Add to a signed chart: kept with its own time and author, never changed. */
export const addAddendumAction = formAction(addendumSchema, async (d) => {
  const ctx = await requireAnyAction(d.slug, ...WRITE);
  const note = await charting(() => withTenant(ctx.business.id, (tx) => addAddendum(tx, ctx.business.id, ctx, d.noteId, d.body)));
  await auditEvent(ctx.business.id, ctx.user.id, "chart.addendum", "chart", note.id, { clientId: note.clientId });
  revalidatePath(`/app/${d.slug}/charts/${note.id}`);
  return "Addendum added";
});

/** Throw away a draft (signed charts stay). */
export async function deleteDraftAction(formData: FormData) {
  const d = z.object({ slug: z.string(), noteId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAnyAction(d.slug, ...WRITE);
  const note = await withTenant(ctx.business.id, (tx) => deleteDraft(tx, ctx, d.noteId));
  await auditEvent(ctx.business.id, ctx.user.id, "chart.delete", "chart", note.id, { clientId: note.clientId, draft: true });
  await setFlash("Draft deleted");
  revalidatePath(`/app/${d.slug}/clients/${note.clientId}/charts`);
  if (note.appointmentId) revalidatePath(`/app/${d.slug}/appointments/${note.appointmentId}`);
  redirect(note.appointmentId ? `/app/${d.slug}/appointments/${note.appointmentId}` : `/app/${d.slug}/clients/${note.clientId}/charts`);
}
