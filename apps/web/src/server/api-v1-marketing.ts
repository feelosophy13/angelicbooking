import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant, type CampaignAudience, type WorkflowFilters, type WorkflowStep, type WorkflowTrigger } from "@angelic/db";
import { zonedToInstant } from "@angelic/core";
import { TRIGGERS, newStepId } from "@/lib/workflows-logic";
import { firstForeign } from "@/lib/api";
import { smsAvailableFor } from "@/server/messaging";
import type { TenantDb } from "@angelic/db";

/**
 * Marketing API: campaigns, promo codes and automations (workflows). Serializers are allow-lists, schemas never use `.default()`
 * (a PATCH must not reset what it did not mention; create applies the defaults below). The business id always comes from the key.
 * The rules are the ones in app/app/[slug]/marketing/actions.ts and automations/actions.ts.
 */
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
type Pg = { limit: number; offset: number };

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
const days = z.number().int().min(1).max(3650);
export const audiencePatch = z.object({
  visited_within_days: days.nullable(),
  lapsed_days: days.nullable(),
  service_id: z.string().max(100).nullable(),
  staff_id: z.string().max(100).nullable(),
  tag: z.string().trim().max(40).nullable(),
  never_visited: z.boolean().nullable(),
  location_id: z.string().max(100).nullable(),
}).partial().strict();
export type AudienceInput = z.infer<typeof audiencePatch>;

/** The stored shape (camelCase, every key present) the app writes; empty strings and missing keys become null/false. */
export function toAudience(a: AudienceInput | undefined): CampaignAudience {
  return {
    visitedWithinDays: a?.visited_within_days ?? null,
    lapsedDays: a?.lapsed_days ?? null,
    serviceId: a?.service_id || null,
    staffId: a?.staff_id || null,
    tag: a?.tag || null,
    neverVisited: a?.never_visited ?? false,
    locationId: a?.location_id || null,
  };
}
export const serializeAudience = (a: CampaignAudience | null | undefined) => ({
  visited_within_days: a?.visitedWithinDays ?? null,
  lapsed_days: a?.lapsedDays ?? null,
  service_id: a?.serviceId ?? null,
  staff_id: a?.staffId ?? null,
  tag: a?.tag ?? null,
  never_visited: a?.neverVisited ?? false,
  location_id: a?.locationId ?? null,
});

export const campaignPatch = z.object({
  name: z.string().trim().min(1).max(100),
  channel: z.enum(["email", "sms"]),
  subject: z.string().trim().max(150).nullable(),
  body: z.string().trim().min(1).max(2000),
  audience: audiencePatch,
}).partial().strict();
export const campaignCreate = campaignPatch.required({ name: true, channel: true, body: true });
export const audiencePreviewInput = z.object({ channel: z.enum(["email", "sms"]), audience: audiencePatch.optional() }).strict();

export const serializeCampaign = (c: typeof schema.campaigns.$inferSelect) => ({
  id: c.id, name: c.name, channel: c.channel, subject: c.subject, body: c.body, audience: serializeAudience(c.audience), status: c.status,
  recipient_count: c.recipientCount, sent_at: iso(c.sentAt), created_at: iso(c.createdAt), updated_at: iso(c.updatedAt),
});

export const listCampaignsApi = (b: string, p: Pg, status?: string) =>
  withTenant(b, (tx) =>
    tx.select().from(schema.campaigns).where(and(eq(schema.campaigns.businessId, b), ...(status ? [eq(schema.campaigns.status, status)] : []))).orderBy(desc(schema.campaigns.createdAt)).limit(p.limit).offset(p.offset),
  );

export const getCampaignApi = (b: string, id: string) =>
  withTenant(b, (tx) => tx.query.campaigns.findFirst({ where: and(eq(schema.campaigns.id, id), eq(schema.campaigns.businessId, b)) }));

/** Campaigns being sent right now by this process: a second send of the same campaign is refused while the first runs. */
const sending = new Set<string>();
export const sendingGuard = {
  tryAcquire: (id: string) => (sending.has(id) ? false : (sending.add(id), true)),
  release: (id: string) => void sending.delete(id),
};

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31").refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Not a real date");
export const promoCreate = z.object({
  code: z.string().trim().min(2).max(30),
  type: z.enum(["percent", "amount"]),
  /** Percent (1 to 100) or cents (at least 1). */
  value: z.number().int().min(1).max(10_000_000),
  starts_on: dateOnly.nullish(),
  expires_on: dateOnly.nullish(),
  max_uses: z.number().int().min(1).max(10_000_000).nullish(),
  min_subtotal_cents: z.number().int().min(0).max(10_000_000).nullish(),
  service_ids: z.array(z.string().max(100)).max(100).nullish(),
}).strict();
export const promoPatch = z.object({ active: z.boolean() }).strict();

/** The app's code normalisation: upper-case, only letters, digits and dashes. */
export const normalizePromoCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9-]/g, "");

export const serializePromo = (p: typeof schema.promoCodes.$inferSelect) => ({
  id: p.id, code: p.code, type: p.type, value: p.value, starts_at: iso(p.startsAt), expires_at: iso(p.expiresAt), max_uses: p.maxUses, uses_count: p.usesCount,
  service_ids: p.serviceIds, min_subtotal_cents: p.minSubtotalCents, active: p.active, created_at: iso(p.createdAt),
});

export const listPromosApi = (b: string, p: Pg, active?: boolean) =>
  withTenant(b, (tx) =>
    tx.select().from(schema.promoCodes).where(and(eq(schema.promoCodes.businessId, b), ...(active === undefined ? [] : [eq(schema.promoCodes.active, active)]))).orderBy(desc(schema.promoCodes.active), asc(schema.promoCodes.code)).limit(p.limit).offset(p.offset),
  );
export const getPromoApi = (b: string, id: string) =>
  withTenant(b, (tx) => tx.query.promoCodes.findFirst({ where: and(eq(schema.promoCodes.id, id), eq(schema.promoCodes.businessId, b)) }));

/** Promo dates are calendar days in the business's time zone: the start is its first minute, the end its last (as the app does). */
export const promoStart = (d: string | null | undefined, tz: string) => (d ? zonedToInstant(d, "00:00", tz) : null);
export const promoEnd = (d: string | null | undefined, tz: string) => (d ? zonedToInstant(d, "23:59", tz) : null);

// ---------------------------------------------------------------------------
// Automations (workflows)
// ---------------------------------------------------------------------------
const TRIGGER_KEYS = TRIGGERS.map((t) => t.key) as [WorkflowTrigger, ...WorkflowTrigger[]];
const ids = z.array(z.string().max(100)).max(100);
export const filtersPatch = z.object({
  service_ids: ids,
  category_ids: ids,
  location_ids: ids,
  staff_ids: ids,
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  min_rating: z.number().int().min(1).max(5).nullable(),
  max_rating: z.number().int().min(1).max(5).nullable(),
  first_visit_only: z.boolean(),
  online_only: z.boolean(),
  days: days.nullable(),
}).partial().strict();
export type FiltersInput = z.infer<typeof filtersPatch>;

export function toFilters(f: FiltersInput | undefined): WorkflowFilters {
  return {
    serviceIds: f?.service_ids ?? [], categoryIds: f?.category_ids ?? [], locationIds: f?.location_ids ?? [], staffIds: f?.staff_ids ?? [], tags: f?.tags ?? [],
    minRating: f?.min_rating ?? null, maxRating: f?.max_rating ?? null, firstVisitOnly: f?.first_visit_only ?? false, onlineOnly: f?.online_only ?? false, days: f?.days ?? null,
  };
}
export const serializeFilters = (f: WorkflowFilters | null | undefined) => ({
  service_ids: f?.serviceIds ?? [], category_ids: f?.categoryIds ?? [], location_ids: f?.locationIds ?? [], staff_ids: f?.staffIds ?? [], tags: f?.tags ?? [],
  min_rating: f?.minRating ?? null, max_rating: f?.maxRating ?? null, first_visit_only: f?.firstVisitOnly ?? false, online_only: f?.onlineOnly ?? false, days: f?.days ?? null,
});

// Steps: the app's step kinds, in snake_case. No "points" step: that would give loyalty points, which the API does not touch.
const sid = z.string().min(1).max(40).optional();
export const stepInput = z.discriminatedUnion("type", [
  z.object({ id: sid, type: z.literal("wait"), mode: z.enum(["delay", "before_appointment", "after_appointment"]), hours: z.number().min(0).max(24 * 365) }).strict(),
  z.object({ id: sid, type: z.literal("sms"), body: z.string().max(1000) }).strict(),
  z.object({ id: sid, type: z.literal("email"), subject: z.string().max(150), body: z.string().max(5000), cta_label: z.string().max(40).nullish() }).strict(),
  z.object({ id: sid, type: z.literal("review_request") }).strict(),
  z.object({ id: sid, type: z.literal("reminder") }).strict(),
  z.object({ id: sid, type: z.literal("tag"), tag: z.string().max(40) }).strict(),
  z.object({ id: sid, type: z.literal("notify_staff"), to: z.enum(["owner", "provider"]), body: z.string().max(2000) }).strict(),
]);
export type StepInput = z.infer<typeof stepInput>;

export function toSteps(steps: StepInput[]): WorkflowStep[] {
  return steps.map((s): WorkflowStep => {
    const id = s.id ?? newStepId();
    return s.type === "email" ? { id, type: "email", subject: s.subject, body: s.body, ctaLabel: s.cta_label ?? null } : ({ ...s, id } as WorkflowStep);
  });
}
export function serializeStep(s: WorkflowStep) {
  if (s.type === "email") return { id: s.id, type: s.type, subject: s.subject, body: s.body, cta_label: s.ctaLabel ?? null };
  return { ...s };
}

export const workflowPatch = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullable(),
  trigger: z.enum(TRIGGER_KEYS),
  enabled: z.boolean(),
  exit_on_booking: z.boolean(),
  filters: filtersPatch,
  steps: z.array(stepInput).max(20),
}).partial().strict();
export const workflowCreate = workflowPatch.required({ name: true, trigger: true, steps: true });
export const WORKFLOW_DEFAULTS = { description: null, enabled: false, exit_on_booking: false } as const;

export type WorkflowWithStats = typeof schema.workflows.$inferSelect & { sent30?: number; active?: number };
export const serializeWorkflow = (w: WorkflowWithStats) => ({
  id: w.id, template_key: w.templateKey, name: w.name, description: w.description, trigger: w.trigger, enabled: w.enabled, exit_on_booking: w.exitOnBooking,
  filters: serializeFilters(w.filters), steps: w.steps.map(serializeStep), sort_order: w.sortOrder, created_at: iso(w.createdAt), updated_at: iso(w.updatedAt),
  ...(w.sent30 !== undefined ? { sent_last_30_days: w.sent30, active_runs: w.active ?? 0 } : {}),
});

export const getWorkflowApi = (b: string, id: string) =>
  withTenant(b, (tx) => tx.query.workflows.findFirst({ where: and(eq(schema.workflows.id, id), eq(schema.workflows.businessId, b)) }));

export const serializeRun = (r: typeof schema.workflowRuns.$inferSelect) => ({
  id: r.id, workflow_id: r.workflowId, client_id: r.clientId, appointment_id: r.appointmentId, status: r.status, step_index: r.stepIndex, next_at: iso(r.nextAt),
  started_at: iso(r.startedAt), finished_at: iso(r.finishedAt), log: r.log.map((l) => ({ at: l.at, step: l.step, event: l.event, detail: l.detail })),
});
export const listRunsApi = (b: string, workflowId: string, p: Pg) =>
  withTenant(b, (tx) =>
    tx.select().from(schema.workflowRuns).where(and(eq(schema.workflowRuns.workflowId, workflowId), eq(schema.workflowRuns.businessId, b))).orderBy(desc(schema.workflowRuns.startedAt)).limit(p.limit).offset(p.offset),
  );

// ---------------------------------------------------------------------------
// Rules shared by the routes
// ---------------------------------------------------------------------------
/** Ids an audience names must belong to this business (the label of the first that does not, else null). */
export const audienceForeign = (tx: TenantDb, b: string, a: CampaignAudience) =>
  firstForeign(tx, b, [[schema.services, a.serviceId, "service"], [schema.staff, a.staffId, "staff member"], [schema.locations, a.locationId, "location"]]);

/** The app's campaign rules (createCampaign / updateCampaign), as a message or null when fine. */
export async function campaignRuleError(b: string, c: { channel: "email" | "sms"; subject: string | null; body: string }): Promise<string | null> {
  if (c.channel === "sms" && !(await smsAvailableFor(b))) return "Texting needs a verified text number (Settings → Text messaging).";
  if (c.channel === "email" && !c.subject) return "Add a subject line";
  if (c.channel === "sms" && c.body.length > 320) return "Keep texts under 320 characters (2 segments)";
  return null;
}

/** Ids a workflow's filters name must belong to this business. */
export const filtersForeign = async (tx: TenantDb, b: string, f: WorkflowFilters): Promise<string | null> => {
  const checks: Parameters<typeof firstForeign>[2] = [];
  for (const id of f.serviceIds ?? []) checks.push([schema.services, id, "service"]);
  for (const id of f.categoryIds ?? []) checks.push([schema.serviceCategories, id, "category"]);
  for (const id of f.locationIds ?? []) checks.push([schema.locations, id, "location"]);
  for (const id of f.staffIds ?? []) checks.push([schema.staff, id, "staff member"]);
  return firstForeign(tx, b, checks);
};
