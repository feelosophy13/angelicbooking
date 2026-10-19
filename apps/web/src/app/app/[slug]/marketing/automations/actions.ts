"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { WorkflowFilters, WorkflowStep, WorkflowTrigger } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { createWorkflow, deleteWorkflow, duplicateWorkflow, setWorkflowEnabled, updateWorkflow, WorkflowError, type WorkflowInput } from "@/server/workflows";
import { TRIGGERS } from "@/lib/workflows-logic";

const triggerKeys = TRIGGERS.map((t) => t.key) as [WorkflowTrigger, ...WorkflowTrigger[]];

const fields = z.object({
  slug: z.string(),
  workflowId: z.string().optional(),
  name: f.text(1, 80),
  description: f.optional(300),
  trigger: z.enum(triggerKeys),
  enabled: f.checkbox(),
  exitOnBooking: f.checkbox(),
  /** Steps are posted as JSON by the editor. */
  steps: z.string(),
  days: z.string().trim().optional(),
  minRating: z.string().trim().optional(),
  maxRating: z.string().trim().optional(),
  firstVisitOnly: f.checkbox(),
  onlineOnly: f.checkbox(),
  tags: f.optional(200),
});

const stepSchema: z.ZodType<WorkflowStep> = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), type: z.literal("wait"), mode: z.enum(["delay", "before_appointment", "after_appointment"]), hours: z.coerce.number().min(0).max(24 * 365) }),
  z.object({ id: z.string().min(1), type: z.literal("sms"), body: z.string().max(1000) }),
  z.object({ id: z.string().min(1), type: z.literal("email"), subject: z.string().max(150), body: z.string().max(5000), ctaLabel: z.string().max(40).nullable().optional() }),
  z.object({ id: z.string().min(1), type: z.literal("review_request") }),
  z.object({ id: z.string().min(1), type: z.literal("reminder") }),
  z.object({ id: z.string().min(1), type: z.literal("tag"), tag: z.string().max(40) }),
  z.object({ id: z.string().min(1), type: z.literal("points"), points: z.coerce.number().int().min(0).max(100_000), note: z.string().max(120).nullable().optional() }),
  z.object({ id: z.string().min(1), type: z.literal("notify_staff"), to: z.enum(["owner", "provider"]), body: z.string().max(2000) }),
]);

function parseInput(d: z.infer<typeof fields>, raw: FormData): WorkflowInput {
  let steps: WorkflowStep[];
  try {
    steps = z.array(stepSchema).max(20).parse(JSON.parse(d.steps || "[]"));
  } catch {
    throw new FormError("The steps could not be read. Reload the page and try again.");
  }
  const ids = (key: string) => raw.getAll(key).map(String).filter(Boolean);
  const num = (v?: string) => (v && v !== "" ? Number(v) : null);
  const filters: WorkflowFilters = {
    serviceIds: ids("serviceIds"),
    categoryIds: ids("categoryIds"),
    locationIds: ids("locationIds"),
    staffIds: ids("staffIds"),
    tags: (d.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    minRating: num(d.minRating),
    maxRating: num(d.maxRating),
    firstVisitOnly: d.firstVisitOnly,
    onlineOnly: d.onlineOnly,
    days: num(d.days),
  };
  return { name: d.name, description: d.description, trigger: d.trigger, enabled: d.enabled, exitOnBooking: d.exitOnBooking, filters, steps };
}

const revalidate = (slug: string, id?: string) => {
  revalidatePath(`/app/${slug}/marketing/automations`);
  if (id) revalidatePath(`/app/${slug}/marketing/automations/${id}`);
};

export const saveWorkflowAction = formAction(fields, async (d, raw) => {
  const ctx = await requireAction(d.slug, "settings.business");
  const input = parseInput(d, raw);
  try {
    if (d.workflowId) {
      await updateWorkflow(ctx.business.id, d.workflowId, input);
      revalidate(d.slug, d.workflowId);
      return input.enabled ? "Saved and on" : "Saved (off)";
    }
    const id = await createWorkflow(ctx.business.id, input);
    await setFlash(`${input.name} created${input.enabled ? " and on" : ""}`);
    revalidate(d.slug, id);
    redirect(`/app/${d.slug}/marketing/automations/${id}`);
  } catch (e) {
    if (e instanceof WorkflowError) throw new FormError(e.message);
    throw e;
  }
});

export async function toggleWorkflow(formData: FormData) {
  const d = z.object({ slug: z.string(), workflowId: z.string().min(1), enabled: z.enum(["true", "false"]) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "settings.business");
  await setWorkflowEnabled(ctx.business.id, d.workflowId, d.enabled === "true");
  await setFlash(d.enabled === "true" ? "Workflow on" : "Workflow off");
  revalidate(d.slug, d.workflowId);
}

export async function duplicateWorkflowAction(formData: FormData) {
  const d = z.object({ slug: z.string(), workflowId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "settings.business");
  const id = await duplicateWorkflow(ctx.business.id, d.workflowId);
  await setFlash("Copied. Edit the copy, then turn it on.");
  revalidate(d.slug, id);
  redirect(`/app/${d.slug}/marketing/automations/${id}`);
}

export async function deleteWorkflowAction(formData: FormData) {
  const d = z.object({ slug: z.string(), workflowId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "settings.business");
  try {
    await deleteWorkflow(ctx.business.id, d.workflowId);
  } catch (e) {
    if (e instanceof WorkflowError) { await setFlash(e.message, "error"); return; }
    throw e;
  }
  await setFlash("Workflow deleted");
  revalidate(d.slug);
  redirect(`/app/${d.slug}/marketing/automations`);
}
