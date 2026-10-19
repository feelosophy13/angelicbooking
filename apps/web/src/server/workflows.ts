/**
 * Workflows: trigger → filters → ordered steps, with the guardrails in code.
 *
 * - Every business gets the same pre-built templates (ensureTemplates), enabled or not;
 *   editing them is how owners "build" automations. Custom workflows are the same rows
 *   without a templateKey.
 * - A trigger occurrence (visit completed, new client, birthday …) starts one run per
 *   matching workflow, once per occasion (dedupeKey). Runs advance until a wait step,
 *   are resumed by the cron, and are cancelled when their appointment is cancelled or,
 *   for "stop if the client books" flows, when the client books again.
 * - Sends go through the notifications table like everything else, tagged with the
 *   run so Settings → Messages and the run log can explain every message.
 * - Guardrails that are never configurable: consent per channel, marketing or
 *   transactional decided per message step (lib/workflows-logic messageConsent), STOP
 *   notice on marketing texts, quiet hours (9am–8pm local) on every text but the reminder
 *   and the booked / cancelled confirmations, one run per occasion, review requests only
 *   once per visit.
 * - The engine never fails the action that fired it: the entry points report and swallow
 *   their errors, and each run advances in a transaction of its own (advanceOne) so one
 *   bad step marks that run failed and leaves the rest of the batch, and every other
 *   tenant, alone. (A savepoint inside the shared transaction would not do: postgres.js
 *   keeps the first failed query of a transaction and throws it at commit.)
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db, schema, withJobs, withTenant, type TenantDb, type WorkflowFilters, type WorkflowRunContext, type WorkflowRunLogEntry, type WorkflowStep, type WorkflowTrigger } from "@angelic/db";
import { instantToISODate, normalizePhone } from "@angelic/core";
import { appUrl } from "@/lib/stripe";
import { appointmentContext, deliverMany } from "@/lib/notify";
import { brandedEmail, marketingEmail, reviewRequestTemplate, templates as messageTemplates, textToHtml, transactionalEmail, clientPhotosLine } from "@/lib/notify/templates";
const reminderTemplate = messageTemplates.reminder;
import { smsBody, smsWithStopNotice } from "@/lib/notify/sms";
import { appointmentVars, renderText, unsubscribeUrl } from "@/server/marketing";
import { pathTo } from "@/server/categories";
import { ensureReferralCode, referralsEnabled } from "./loyalty";
import { locationTimeZones, NO_POSTAL_ADDRESS, postalAddress } from "./locations";
import { siteUrl } from "@/lib/site-url";
import { reportError } from "@/lib/report-error";
import { bookedAhead, lastCompletedVisits } from "./visit-sql";
import { APPOINTMENT_TRIGGERS, birthdayKeys, deferToDaytime, matchesFilters, messageConsent, newStepId, noVisitWindow, validateSteps, waitResumesAt, type TriggerFacts } from "@/lib/workflows-logic";

type Business = typeof schema.businesses.$inferSelect;
export type Workflow = typeof schema.workflows.$inferSelect;
export type WorkflowRun = typeof schema.workflowRuns.$inferSelect;

export class WorkflowError extends Error {}

// ---------------------------------------------------------------------------
// Templates every business gets
// ---------------------------------------------------------------------------
export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  enabled: boolean;
  exitOnBooking?: boolean;
  filters?: WorkflowFilters;
  steps: StepDef[];
  /** Grouping on the Automations page. */
  group: "before" | "after" | "touch" | "team";
}

/** A step without its id (distributive over the union so each variant keeps its own fields). */
export type StepDef = WorkflowStep extends infer T ? (T extends WorkflowStep ? Omit<T, "id"> : never) : never;
const S = (steps: StepDef[]) => steps;

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  { key: "reminder", group: "before", trigger: "appointment_booked", enabled: true, name: "Appointment reminder", description: "The standard reminder with the details, manage link, outstanding forms and any “before your visit” notes from the services booked. Moves with the appointment; dropped if it is cancelled.", steps: S([
    { type: "wait", mode: "before_appointment", hours: 24 },
    { type: "reminder" },
  ]) },
  { key: "review_request", group: "after", trigger: "appointment_completed", enabled: true, name: "Ask for a rating", description: "A one-tap star rating after each visit; 4–5 stars are invited on to Google when a link is set.", steps: S([
    { type: "wait", mode: "after_appointment", hours: 2 },
    { type: "review_request" },
  ]) },
  { key: "rebook", group: "after", trigger: "appointment_completed", enabled: false, exitOnBooking: true, name: "Rebook reminder", description: "A nudge a few weeks after a visit when nothing else is booked.", steps: S([
    { type: "wait", mode: "delay", hours: 28 * 24 },
    { type: "email", subject: "Time for your next visit?", body: "Hi {first_name},\n\nIt's about time for your next appointment at {business}. Grab a time that suits you." },
  ]) },
  { key: "refer_friend", group: "after", trigger: "appointment_completed", enabled: false, filters: { firstVisitOnly: true }, name: "Refer a friend", description: "After a client's first paid visit, send their referral code and what each side earns. Needs Loyalty & referrals turned on.", steps: S([
    { type: "wait", mode: "after_appointment", hours: 48 },
    { type: "email", subject: "Know someone who'd love {business}?", body: "Hi {first_name},\n\nThanks for visiting {business}! If a friend books with your referral code, you both get something back.\n\nYour code: {referral_code}\n\nThey just type it in the referral box when booking online." },
  ]) },
  { key: "no_show_follow_up", group: "after", trigger: "appointment_no_show", enabled: false, name: "No-show follow-up", description: "A friendly note after a missed appointment with a link to rebook.", steps: S([
    { type: "wait", mode: "delay", hours: 1 },
    { type: "sms", body: "{business}: we missed you today for your {service}. Everything OK? Rebook any time: {booking_url}" },
    { type: "email", subject: "We missed you today", body: "Hi {first_name},\n\nWe missed you for your {service} with {staff}. If something came up, no problem at all; you can book another time below." },
  ]) },
  { key: "aftercare", group: "after", trigger: "appointment_completed", enabled: false, name: "Aftercare tips", description: "Care instructions the day after specific services or categories (set the filter).", steps: S([
    { type: "wait", mode: "after_appointment", hours: 20 },
    { type: "sms", body: "{business}: thanks for coming in! To keep your {service} looking its best, avoid washing for 48 hours and use a sulfate-free shampoo. Questions? Just reply." },
  ]) },
  { key: "welcome", group: "touch", trigger: "client_created", enabled: false, name: "Welcome new clients", description: "A welcome the day a client first appears, with what to expect.", steps: S([
    { type: "wait", mode: "delay", hours: 1 },
    { type: "email", subject: "Welcome to {business}", body: "Hi {first_name},\n\nWelcome! We're glad you found us. Here's what to expect on your first visit: arrive 5 minutes early, bring any inspiration photos, and tell us about allergies or sensitivities.\n\nYou can book, reschedule and see your visits online any time." },
  ]) },
  { key: "birthday", group: "touch", trigger: "birthday", enabled: false, name: "Birthday message", description: "On the client's birthday, from the birthday on their profile.", steps: S([
    { type: "email", subject: "Happy birthday from {business}!", body: "Happy birthday, {first_name}! 🎉\n\nTreat yourself this month and we'll make it special." },
  ]) },
  { key: "win_back", group: "touch", trigger: "no_visit", enabled: false, exitOnBooking: true, filters: { days: 60 }, name: "We miss you", description: "Once, when a client hasn't visited for this many days and has nothing booked.", steps: S([
    { type: "email", subject: "We miss you at {business}", body: "Hi {first_name},\n\nIt's been a while! We'd love to see you again. Book your next visit below." },
  ]) },
  { key: "membership_save", group: "touch", trigger: "membership_payment_failed", enabled: true, name: "Membership payment failed", description: "Tell the client their renewal didn't go through and how to fix it.", steps: S([
    { type: "email", subject: "Your {membership} payment didn't go through", body: "Hi {first_name},\n\nWe couldn't renew your {membership} at {business}. Your membership is paused until the card is updated. Sign in below or call us and we'll sort it in a minute." },
  ]) },
  { key: "low_rating_alert", group: "team", trigger: "review_submitted", enabled: true, filters: { maxRating: 3 }, name: "Low rating alert", description: "Email the owner when a client leaves 3 stars or fewer, so you can call them the same day.", steps: S([
    { type: "notify_staff", to: "owner", body: "{first_name} rated their {service} with {staff} {rating}/5.\n\n{comment}" },
  ]) },
  { key: "new_online_booking", group: "team", trigger: "appointment_booked", enabled: true, filters: { onlineOnly: true }, name: "New online booking", description: "Email you and the provider the moment a client books online. Appointments the desk enters are skipped.", steps: S([
    { type: "notify_staff", to: "owner", body: "{first_name} just booked {service} with {staff} for {when} through online booking." },
    { type: "notify_staff", to: "provider", body: "{first_name} just booked {service} with you for {when} through online booking." },
  ]) },
];

const withIds = (steps: StepDef[]): WorkflowStep[] => steps.map((s) => ({ ...s, id: newStepId() }) as WorkflowStep);

/**
 * Make sure every template exists for the business (new businesses, new templates added later).
 * The first time, settings from the old fixed automations and the review-request switch are
 * carried over so nothing changes behaviour for existing tenants.
 */
export async function ensureTemplates(business: Business): Promise<void> {
  await withTenant(business.id, async (tx) => {
    const existing = await tx.select({ templateKey: schema.workflows.templateKey }).from(schema.workflows);
    const have = new Set(existing.map((e) => e.templateKey));
    const legacy = await tx.select().from(schema.automations);
    const [agg] = await tx.select({ max: sql<number>`coalesce(max(${schema.workflows.sortOrder}), -1)` }).from(schema.workflows);
    let order = Number(agg?.max ?? -1) + 1;
    for (const t of WORKFLOW_TEMPLATES) {
      if (have.has(t.key)) continue;
      let enabled = t.enabled;
      let steps = withIds(t.steps);
      let filters: WorkflowFilters = t.filters ?? {};
      const old = legacy.find((a) => a.kind === t.key);
      if (old) {
        enabled = old.enabled;
        const wantEmail = old.channel === "email" || old.channel === "both";
        const wantSms = old.channel === "sms" || old.channel === "both";
        const msgs: WorkflowStep[] = [];
        if (wantSms) msgs.push({ id: newStepId(), type: "sms", body: old.body });
        const tplEmail = t.steps.find((x): x is Extract<StepDef, { type: "email" }> => x.type === "email");
        if (wantEmail) msgs.push({ id: newStepId(), type: "email", subject: old.subject ?? tplEmail?.subject ?? t.name, body: old.body });
        if (t.key === "rebook") steps = [{ id: newStepId(), type: "wait", mode: "delay", hours: old.days * 24 }, ...msgs];
        else if (t.key === "win_back") { steps = msgs; filters = { days: old.days }; }
        else steps = msgs;
      }
      if (t.key === "reminder") steps = [{ id: newStepId(), type: "wait", mode: "before_appointment", hours: Math.max(1, business.reminderHours) }, { id: newStepId(), type: "reminder" }];
      if (t.key === "review_request") {
        enabled = business.reviewRequestEnabled;
        steps = [{ id: newStepId(), type: "wait", mode: "after_appointment", hours: Math.max(0, business.reviewRequestDelayHours) }, { id: newStepId(), type: "review_request" }];
      }
      await tx.insert(schema.workflows).values({ businessId: business.id, templateKey: t.key, name: t.name, description: t.description, trigger: t.trigger, enabled, filters, steps, exitOnBooking: !!t.exitOnBooking, sortOrder: order++ }).onConflictDoNothing();
    }
  });
}

export const templateGroup = (w: Workflow): WorkflowTemplate["group"] => WORKFLOW_TEMPLATES.find((t) => t.key === w.templateKey)?.group ?? (w.trigger === "appointment_booked" ? "before" : APPOINTMENT_TRIGGERS.includes(w.trigger) ? "after" : w.trigger === "review_submitted" || w.trigger === "form_submitted" ? "team" : "touch");

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export async function listWorkflows(business: Business) {
  await ensureTemplates(business);
  return withTenant(business.id, async (tx) => {
    const rows = await tx.select().from(schema.workflows).orderBy(asc(schema.workflows.sortOrder), asc(schema.workflows.name));
    const since = new Date(Date.now() - 30 * 86_400_000);
    const sent = await tx
      .select({ workflowId: schema.workflowRuns.workflowId, n: sql<number>`count(*)` })
      .from(schema.notifications)
      .innerJoin(schema.workflowRuns, eq(schema.workflowRuns.id, schema.notifications.workflowRunId))
      .where(and(eq(schema.notifications.status, "sent"), gte(schema.notifications.sentAt, since)))
      .groupBy(schema.workflowRuns.workflowId);
    const active = await tx.select({ workflowId: schema.workflowRuns.workflowId, n: sql<number>`count(*)` }).from(schema.workflowRuns).where(eq(schema.workflowRuns.status, "active")).groupBy(schema.workflowRuns.workflowId);
    return rows.map((w) => ({ ...w, sent30: Number(sent.find((s) => s.workflowId === w.id)?.n ?? 0), active: Number(active.find((s) => s.workflowId === w.id)?.n ?? 0) }));
  });
}

export async function getWorkflow(businessId: string, id: string) {
  return withTenant(businessId, (tx) => tx.query.workflows.findFirst({ where: eq(schema.workflows.id, id) }));
}

export async function recentRuns(businessId: string, workflowId: string, limit = 20) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ run: schema.workflowRuns, firstName: schema.clients.firstName, lastName: schema.clients.lastName })
      .from(schema.workflowRuns)
      .leftJoin(schema.clients, eq(schema.clients.id, schema.workflowRuns.clientId))
      .where(eq(schema.workflowRuns.workflowId, workflowId))
      .orderBy(desc(schema.workflowRuns.startedAt))
      .limit(limit),
  );
}

export type WorkflowInput = { name: string; description: string | null; trigger: WorkflowTrigger; enabled: boolean; filters: WorkflowFilters; steps: WorkflowStep[]; exitOnBooking: boolean };

function assertValid(input: WorkflowInput) {
  const errors = validateSteps(input.steps, input.trigger);
  if (input.trigger === "no_visit" && !(input.filters.days && input.filters.days > 0)) errors.push("Enter how many days without a visit.");
  if (errors.length) throw new WorkflowError(errors.join(" "));
}

export async function createWorkflow(businessId: string, input: WorkflowInput): Promise<string> {
  assertValid(input);
  return withTenant(businessId, async (tx) => {
    const [agg] = await tx.select({ max: sql<number>`coalesce(max(${schema.workflows.sortOrder}), -1)` }).from(schema.workflows);
    const [row] = await tx.insert(schema.workflows).values({ businessId, ...input, sortOrder: Number(agg?.max ?? -1) + 1 }).returning({ id: schema.workflows.id });
    return row!.id;
  });
}

export async function updateWorkflow(businessId: string, id: string, input: WorkflowInput) {
  assertValid(input);
  await withTenant(businessId, async (tx) => {
    const current = await tx.query.workflows.findFirst({ where: eq(schema.workflows.id, id) });
    if (!current) throw new WorkflowError("Workflow not found.");
    await tx.update(schema.workflows).set({ ...input, updatedAt: new Date() }).where(eq(schema.workflows.id, id));
    // A trigger change makes in-flight runs meaningless.
    if (current.trigger !== input.trigger) await cancelRuns(tx, { workflowId: id }, "Workflow trigger changed");
  });
}

export async function setWorkflowEnabled(businessId: string, id: string, enabled: boolean) {
  await withTenant(businessId, async (tx) => {
    await tx.update(schema.workflows).set({ enabled, updatedAt: new Date() }).where(eq(schema.workflows.id, id));
    if (!enabled) await cancelRuns(tx, { workflowId: id }, "Workflow turned off");
  });
}

export async function duplicateWorkflow(businessId: string, id: string): Promise<string> {
  const w = await getWorkflow(businessId, id);
  if (!w) throw new WorkflowError("Workflow not found.");
  return createWorkflow(businessId, { name: `${w.name} (copy)`, description: w.description, trigger: w.trigger, enabled: false, filters: w.filters, steps: w.steps.map((s) => ({ ...s, id: newStepId() })), exitOnBooking: w.exitOnBooking });
}

export async function deleteWorkflow(businessId: string, id: string) {
  await withTenant(businessId, async (tx) => {
    const w = await tx.query.workflows.findFirst({ where: eq(schema.workflows.id, id) });
    if (!w) return;
    // Current templates can only be turned off; a template that has since been retired can go.
    if (w.templateKey && WORKFLOW_TEMPLATES.some((t) => t.key === w.templateKey)) throw new WorkflowError("Built-in workflows can be turned off but not deleted.");
    await tx.delete(schema.workflows).where(eq(schema.workflows.id, id));
  });
}

// ---------------------------------------------------------------------------
// Triggering
// ---------------------------------------------------------------------------
export interface TriggerInput {
  clientId: string | null;
  appointmentId?: string | null;
  /** Once per occasion: appointment id, submission id, "clientId:year" … */
  dedupeKey: string;
  facts?: TriggerFacts;
  context?: WorkflowRunContext;
  /** Start only these workflows (a reschedule restarts just the ones timed from the visit). */
  onlyWorkflowIds?: string[];
  /** Skip workflows with a reminder step (an API booking made with reminders:false). */
  withoutReminders?: boolean;
}

/** Automations never fail the action that fired them: an engine error is reported and swallowed, and the caller gets `fallback`. */
async function guarded<T>(what: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    await reportError(`workflows: ${what} failed`, e);
    return fallback;
  }
}

/** Facts about an appointment for filters and vars (services, categories with ancestors, location, provider, first visit). */
export async function appointmentFacts(tx: TenantDb, appointmentId: string): Promise<(TriggerFacts & { clientId: string | null; locationId: string | null; staffId: string | null; serviceIds: string[]; categoryIds: string[] }) | null> {
  const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId) });
  if (!appt) return null;
  const items = await tx.select({ serviceId: schema.appointmentItems.serviceId, staffId: schema.appointmentItems.staffId, status: schema.appointmentItems.status }).from(schema.appointmentItems).where(eq(schema.appointmentItems.appointmentId, appointmentId)).orderBy(asc(schema.appointmentItems.sortOrder));
  const live = items.filter((i) => i.status !== "cancelled");
  const use = live.length ? live : items;
  const serviceIds = [...new Set(use.map((i) => i.serviceId).filter((x): x is string => !!x))];
  const services = serviceIds.length ? await tx.select({ id: schema.services.id, categoryId: schema.services.categoryId }).from(schema.services).where(inArray(schema.services.id, serviceIds)) : [];
  const cats = await tx.select().from(schema.serviceCategories);
  const categoryIds = [...new Set(services.flatMap((s) => (s.categoryId ? [s.categoryId, ...pathTo(cats, s.categoryId).map((c) => c.id)] : [])))];
  const client = appt.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, appt.clientId) }) : null;
  // First visit = no completed visit before this one. A visit pre-booked for next month doesn't make today's the second.
  const start = (await appointmentTimes(tx, appointmentId))?.startAt ?? new Date();
  const [prior] = appt.clientId
    ? await tx
        .select({ n: sql<number>`count(*)` })
        .from(schema.appointments)
        .innerJoin(schema.appointmentItems, eq(schema.appointmentItems.appointmentId, schema.appointments.id))
        .where(and(eq(schema.appointments.clientId, appt.clientId), ne(schema.appointments.id, appt.id), eq(schema.appointments.kind, "visit"), eq(schema.appointments.status, "completed"), lt(schema.appointmentItems.startAt, start)))
    : [{ n: 0 }];
  return { clientId: appt.clientId, locationId: appt.locationId, staffId: use[0]?.staffId ?? null, serviceIds, categoryIds, clientTags: client?.tags ?? [], firstVisit: Number(prior?.n ?? 0) === 0, source: appt.source };
}

/**
 * Start runs for every enabled workflow on `trigger` whose filters match, then advance
 * them right away (so delay-less steps send immediately). Delivery happens after the
 * caller's response via the returned promise, or on the next cron run regardless.
 */
export async function triggerWorkflows(business: Business, trigger: WorkflowTrigger, input: TriggerInput): Promise<number> {
  return guarded(`${trigger} trigger`, 0, async () => {
    // A business that has never opened Automations still gets the defaults (e.g. rating requests), and one that
    // has gets any template added since (it is a no-op once they all exist).
    await ensureTemplates(business);
    const now = new Date();
    // The runs start in one transaction (once per occasion), then each advances in its own (advanceOne).
    const started = await withTenant(business.id, async (tx) => {
      const flows = await tx.select().from(schema.workflows).where(and(eq(schema.workflows.trigger, trigger), eq(schema.workflows.enabled, true)));
      const facts = input.facts ?? {};
      const out: { w: Workflow; runId: string }[] = [];
      for (const w of flows) {
        if (input.onlyWorkflowIds && !input.onlyWorkflowIds.includes(w.id)) continue;
        if (input.withoutReminders && w.steps.some((st) => st.type === "reminder")) continue;
        if (!matchesFilters(w.filters, facts)) continue;
        const [run] = await tx
          .insert(schema.workflowRuns)
          .values({ businessId: business.id, workflowId: w.id, clientId: input.clientId, appointmentId: input.appointmentId ?? null, dedupeKey: input.dedupeKey, nextAt: now, context: { ...input.context, locationId: facts.locationId ?? input.context?.locationId ?? null, staffId: facts.staffId ?? input.context?.staffId ?? null, serviceIds: facts.serviceIds, categoryIds: facts.categoryIds }, log: [{ at: now.toISOString(), step: null, event: "started", detail: input.context?.reason ?? triggerLabel(trigger) }] })
          .onConflictDoNothing()
          .returning({ id: schema.workflowRuns.id });
        if (run) out.push({ w, runId: run.id });
      }
      return out;
    });
    const ids: string[] = [];
    for (const { w, runId } of started) await advanceOne(business, w, runId, now, { fresh: true }, ids);
    if (ids.length) void deliverMany(business.id, ids).catch((e) => console.error("[workflows] delivery failed", (e as Error).message));
    return ids.length;
  });
}

const triggerLabel = (t: WorkflowTrigger) => ({ appointment_booked: "Appointment booked", appointment_completed: "Visit completed", appointment_cancelled: "Appointment cancelled", appointment_no_show: "No-show", client_created: "New client", form_submitted: "Form submitted", review_submitted: "Review received", membership_payment_failed: "Membership payment failed", birthday: "Birthday", no_visit: "No recent visit" })[t];

/** Appointment-driven triggers in one call (used by the booking, status and checkout paths). */
export async function triggerAppointmentWorkflows(business: Business, trigger: Extract<WorkflowTrigger, `appointment_${string}`>, appointmentId: string, opts: { withoutReminders?: boolean } = {}) {
  return guarded(`${trigger} trigger`, 0, async () => {
    const [facts, times] = await withTenant(business.id, async (tx) => [await appointmentFacts(tx, appointmentId), await appointmentTimes(tx, appointmentId)] as const);
    if (!facts || !facts.clientId) return 0;
    // "Booked" flows are per time slot: moving the appointment starts them again for the new time.
    const dedupeKey = trigger === "appointment_booked" && times ? `${appointmentId}:${times.startAt.getTime()}` : appointmentId;
    return triggerWorkflows(business, trigger, { clientId: facts.clientId, appointmentId, dedupeKey, facts, context: { appointmentId, reason: triggerLabel(trigger) }, withoutReminders: opts.withoutReminders });
  });
}

/**
 * Everything automations do when an appointment is made, whichever path made it (online, the desk with or without a confirmation, a
 * later visit in a series, the API, an import): its "Appointment booked" workflows start (the ones with a reminder step only when
 * `reminders`), and the client's "stop if they book again" runs stop.
 */
export async function afterAppointmentBooked(business: Business, appointmentId: string, opts: { reminders?: boolean } = {}) {
  await triggerAppointmentWorkflows(business, "appointment_booked", appointmentId, { withoutReminders: opts.reminders === false });
  const appt = await guarded("reading the booked appointment", null, () => withTenant(business.id, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId), columns: { clientId: true } })));
  if (appt?.clientId) await noteClientBooked(business, appt.clientId, { exceptAppointmentId: appointmentId });
}

/** Cancel runs: everything active for a workflow, an appointment, or a client. */
async function cancelRuns(tx: TenantDb, by: { workflowId?: string; appointmentId?: string; clientId?: string }, reason: string) {
  const conds = [eq(schema.workflowRuns.status, "active")];
  if (by.workflowId) conds.push(eq(schema.workflowRuns.workflowId, by.workflowId));
  if (by.appointmentId) conds.push(eq(schema.workflowRuns.appointmentId, by.appointmentId));
  if (by.clientId) conds.push(eq(schema.workflowRuns.clientId, by.clientId));
  const runs = await tx.select({ id: schema.workflowRuns.id }).from(schema.workflowRuns).where(and(...conds));
  for (const r of runs) await cancelRun(tx, r.id, reason);
}

/** Cancel one run. The log line is appended in SQL so a cron holding the row doesn't lose it (or we its). */
async function cancelRun(tx: TenantDb, runId: string, reason: string) {
  const entry: WorkflowRunLogEntry = { at: new Date().toISOString(), step: null, event: "cancelled", detail: reason };
  await tx
    .update(schema.workflowRuns)
    .set({ status: "cancelled", finishedAt: new Date(), nextAt: null, log: sql`${schema.workflowRuns.log} || ${JSON.stringify([entry])}::jsonb` })
    .where(and(eq(schema.workflowRuns.id, runId), eq(schema.workflowRuns.status, "active")));
  // Anything queued but not yet sent by this run goes with it.
  await tx.update(schema.notifications).set({ status: "cancelled", error: reason }).where(and(eq(schema.notifications.workflowRunId, runId), eq(schema.notifications.status, "queued")));
}

/**
 * The appointment moved or was cancelled: runs waiting on it are re-timed or dropped.
 * Called from the same places that move / drop the standard reminder.
 */
export async function resyncAppointmentRuns(business: Business, appointmentId: string, change: "rescheduled" | "cancelled") {
  await guarded(`resync after ${change}`, undefined, () => resync(business, appointmentId, change));
}

async function resync(business: Business, appointmentId: string, change: "rescheduled" | "cancelled") {
  let timed: string[] = [];
  await withTenant(business.id, async (tx) => {
    if (change === "cancelled") {
      // Only "before the visit" flows (booked trigger) stop; follow-ups after a visit are unaffected.
      const runs = await tx.select({ id: schema.workflowRuns.id, workflowId: schema.workflowRuns.workflowId }).from(schema.workflowRuns).where(and(eq(schema.workflowRuns.appointmentId, appointmentId), eq(schema.workflowRuns.status, "active")));
      for (const r of runs) {
        const w = await tx.query.workflows.findFirst({ where: eq(schema.workflows.id, r.workflowId), columns: { trigger: true } });
        if (w?.trigger === "appointment_booked") await cancelRuns(tx, { appointmentId, workflowId: r.workflowId }, "Appointment cancelled");
      }
      return;
    }
    // Moved: only "booked" flows timed from the visit (a "before the appointment" wait, like the reminder) stop and start again for the new
    // time, so a reminder already sent is sent again for the new slot. Flows that aren't about the visit's time (a thank-you for booking, a
    // "new online booking" alert) don't run again.
    const flows = await tx.select().from(schema.workflows).where(and(eq(schema.workflows.trigger, "appointment_booked"), eq(schema.workflows.enabled, true)));
    timed = flows.filter((w) => w.steps.some((st) => st.type === "wait" && st.mode === "before_appointment")).map((w) => w.id);
    for (const id of timed) await cancelRuns(tx, { appointmentId, workflowId: id }, "Appointment moved; restarted for the new time");
  });
  if (!timed.length) return;
  const [facts, times] = await withTenant(business.id, async (tx) => [await appointmentFacts(tx, appointmentId), await appointmentTimes(tx, appointmentId)] as const);
  if (!facts?.clientId || !times) return;
  // Each move is its own occasion (moving back to an earlier time must still remind).
  await triggerWorkflows(business, "appointment_booked", { clientId: facts.clientId, appointmentId, dedupeKey: `${appointmentId}:${times.startAt.getTime()}:moved:${Date.now()}`, facts, context: { appointmentId, reason: "Appointment moved" }, onlyWorkflowIds: timed });
}

/** Stop "until they book again" runs for a client who just booked (other than runs about the new visit itself). */
export async function noteClientBooked(business: Business, clientId: string, opts: { exceptAppointmentId?: string } = {}) {
  await guarded("noting a booking", undefined, () =>
    withTenant(business.id, async (tx) => {
      const runs = await tx.select({ id: schema.workflowRuns.id, workflowId: schema.workflowRuns.workflowId, appointmentId: schema.workflowRuns.appointmentId }).from(schema.workflowRuns).where(and(eq(schema.workflowRuns.clientId, clientId), eq(schema.workflowRuns.status, "active")));
      for (const r of runs) {
        if (opts.exceptAppointmentId && r.appointmentId === opts.exceptAppointmentId) continue;
        const w = await tx.query.workflows.findFirst({ where: eq(schema.workflows.id, r.workflowId), columns: { exitOnBooking: true } });
        if (w?.exitOnBooking) await cancelRun(tx, r.id, "Client booked again");
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Running steps
// ---------------------------------------------------------------------------
async function appointmentTimes(tx: TenantDb, appointmentId: string): Promise<{ startAt: Date; endAt: Date; status: string } | null> {
  const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId), columns: { status: true } });
  if (!appt) return null;
  const [t] = await tx.select({ start: sql<Date>`min(${schema.appointmentItems.startAt})`, end: sql<Date>`max(${schema.appointmentItems.endAt})` }).from(schema.appointmentItems).where(and(eq(schema.appointmentItems.appointmentId, appointmentId), ne(schema.appointmentItems.status, "cancelled")));
  if (!t?.start) return null;
  return { startAt: new Date(t.start), endAt: new Date(t.end), status: appt.status };
}

/** Vars for message steps: client + business always, appointment / review / form / membership when the run has one. */
async function varsFor(tx: TenantDb, business: Business, w: Workflow, run: WorkflowRun, client: typeof schema.clients.$inferSelect) {
  const bookingUrl = siteUrl(business);
  let vars: Record<string, string | number | null | undefined> = { first_name: client.firstName, business: business.name, booking_url: bookingUrl, points: null, referral_code: "" };
  if (referralsEnabled(business)) vars.referral_code = await ensureReferralCode(tx, client).catch(() => "");
  let ctaUrl = bookingUrl;
  let ctaLabel = "Book now";
  let brand = { businessName: business.name, logoUrl: business.logoUrl, brandColor: business.brandColor, businessPhone: business.phone, address: business.addressLine };
  let apptCtx: Awaited<ReturnType<typeof appointmentContext>> = null;
  if (run.appointmentId) {
    apptCtx = await appointmentContext(tx, business, run.appointmentId);
    if (apptCtx) {
      vars = { ...vars, ...appointmentVars(business, apptCtx.ctx), review_url: "" };
      brand = { businessName: apptCtx.ctx.businessName, logoUrl: business.logoUrl, brandColor: business.brandColor, businessPhone: apptCtx.ctx.businessPhone, address: apptCtx.ctx.address };
      if (w.trigger === "appointment_booked") { ctaUrl = apptCtx.ctx.manageUrl; ctaLabel = "Manage appointment"; }
      const review = await tx.query.reviews.findFirst({ where: eq(schema.reviews.appointmentId, run.appointmentId) });
      if (review) vars.review_url = siteUrl(business, `/review/${review.token}`);
    }
  }
  if (w.trigger === "review_submitted") {
    vars.rating = run.context.rating ?? "";
    const review = run.context.appointmentId ? await tx.query.reviews.findFirst({ where: eq(schema.reviews.appointmentId, run.context.appointmentId) }) : null;
    vars.comment = review?.comment ?? "";
  }
  if (w.trigger === "form_submitted" && run.context.formId) vars.form = (await tx.query.forms.findFirst({ where: eq(schema.forms.id, run.context.formId), columns: { name: true } }))?.name ?? "";
  if (w.trigger === "membership_payment_failed" && run.context.membershipId) {
    const m = await tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.id, run.context.membershipId) });
    const plan = m ? await tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, m.planId), columns: { name: true } }) : null;
    vars.membership = plan?.name ?? "membership";
    if (business.clientAccountsEnabled) { ctaUrl = siteUrl(business, `/account`); ctaLabel = "Update your card"; }
  }
  return { vars, ctaUrl, ctaLabel, brand, apptCtx };
}

/** Dates in run logs read like the rest of the app: the business's clock, not ISO. */
const whenIn = (business: Business) => {
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });
  return (at: Date) => fmt.format(at);
};

/**
 * Execute steps from the run's current index until a wait stops it or it finishes.
 * Appends to the run log and queues notifications (ids collected in `out`).
 * A run resumed by the cron starts at its wait step: a delay has simply passed, while a "before / after the visit" wait is re-derived
 * from the appointment's current time, so a visit moved without a notification (API notify:false) still gets its messages at the
 * right moment.
 */
async function advanceRun(tx: TenantDb, business: Business, w: Workflow, run: WorkflowRun, now: Date, out: string[]) {
  const log: WorkflowRunLogEntry[] = [...run.log];
  const when = whenIn(business);
  const note = (step: number | null, event: WorkflowRunLogEntry["event"], detail: string) => log.push({ at: new Date().toISOString(), step, event, detail });
  const finish = async (status: "done" | "cancelled", stepIndex: number, nextAt: Date | null = null) => {
    await tx.update(schema.workflowRuns).set({ status, stepIndex, nextAt, finishedAt: new Date(), log }).where(eq(schema.workflowRuns.id, run.id));
  };
  const client = run.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, run.clientId) }) : null;
  if (!client) { note(null, "cancelled", "Client no longer exists"); await finish("cancelled", run.stepIndex); return; }
  let i = run.stepIndex;
  let vars: Awaited<ReturnType<typeof varsFor>> | null = null;
  const getVars = async () => (vars ??= await varsFor(tx, business, w, run, client));
  // Set when a "before the appointment" wait was already past the first time it was reached (booked inside the reminder window): the
  // message right after it is skipped, since the confirmation just went out; a run resuming after its wait is not affected.
  let skipNextMessage = false;
  for (; i < w.steps.length; i++) {
    const step = w.steps[i]!;
    // Guards before every step, waits included.
    if (run.appointmentId && w.trigger === "appointment_booked") {
      const t = await appointmentTimes(tx, run.appointmentId);
      if (!t || t.status === "cancelled" || t.status === "no_show") { note(i, "cancelled", "Appointment cancelled"); await finish("cancelled", i); return; }
    }
    // "Stop if the client books again": anything on the calendar counts, whether it was booked before or after this run started
    // (pre-booking the next visit at checkout is the normal flow), other than the visit this run is about.
    if (w.exitOnBooking) {
      const conds = [eq(schema.appointments.clientId, client.id), inArray(schema.appointments.status, ["booked", "confirmed"]), ne(schema.appointmentItems.status, "cancelled"), gte(schema.appointmentItems.startAt, now)];
      if (run.appointmentId) conds.push(ne(schema.appointments.id, run.appointmentId));
      const [up] = await tx.select({ n: sql<number>`count(*)` }).from(schema.appointments).innerJoin(schema.appointmentItems, eq(schema.appointmentItems.appointmentId, schema.appointments.id)).where(and(...conds));
      if (Number(up?.n ?? 0) > 0) { note(i, "cancelled", "Client has a visit booked"); await finish("cancelled", i); return; }
    }
    if (step.type === "wait") {
      // Resuming = the cron woke this run from this very wait (it logged "waiting" here); a fresh run reaching the step is not.
      const resuming = i === run.stepIndex && run.log.some((l) => l.event === "waiting" && l.step === i);
      // A plain delay that the cron woke us for has passed; a wait timed from the visit is re-derived from where the visit is now.
      if (resuming && step.mode === "delay") continue;
      const times = run.appointmentId ? await appointmentTimes(tx, run.appointmentId) : null;
      const at = waitResumesAt(step, now, times);
      if (!at) { note(i, "skipped", "No appointment to time this wait from"); continue; }
      if (step.mode === "before_appointment" && at <= now && !resuming) {
        skipNextMessage = true;
        note(i, "skipped", "Booked inside this window: the confirmation covers it");
        continue;
      }
      if (step.mode === "before_appointment" && resuming && times && times.startAt <= now) {
        skipNextMessage = true;
        note(i, "skipped", "The appointment was moved earlier and has already started");
        continue;
      }
      if (at > now) {
        note(i, "waiting", resuming ? `Appointment moved: resumes ${when(at)}` : `Resumes ${when(at)}`);
        await tx.update(schema.workflowRuns).set({ stepIndex: i, nextAt: at, log }).where(eq(schema.workflowRuns.id, run.id));
        return;
      }
      continue;
    }
    if (step.type === "sms" || step.type === "email") {
      if (skipNextMessage) { skipNextMessage = false; note(i, "skipped", "Not sent: booked inside the reminder window"); continue; }
      const v = await getVars();
      // Marketing or transactional is decided per step (messageConsent): a rebook nudge weeks after a visit is marketing, the
      // aftercare text the next day is part of the visit.
      const consent = messageConsent(w.trigger, w.steps, i);
      const marketing = consent.marketing;
      // Quiet hours where the client is: the visit's location, else their usual one.
      const zone = (await locationTimeZones(tx, business))(run.context.locationId ?? client?.homeLocationId);
      const scheduledAt = (step.type === "sms" ? consent.quietHours : marketing) ? deferToDaytime(now, zone) : now;
      const deferred = scheduledAt > now ? ` (held until ${when(scheduledAt)}, quiet hours)` : "";
      if (step.type === "sms") {
        const phone = normalizePhone(client.phone);
        if (!client.smsOptIn || !phone) { note(i, "skipped", "No text consent or number"); continue; }
        if (marketing && !client.smsMarketingOptIn) { note(i, "skipped", "No consent to marketing texts"); continue; }
        // Texts start with the business's name; a template that already does (e.g. "{business}: ...") isn't prefixed twice.
        const text = renderText(step.body, v.vars);
        const body = await smsWithStopNotice(tx, client, text.startsWith(`${v.brand.businessName}:`) ? text : `${v.brand.businessName}: ${text}`, marketing);
        const [row] = await tx.insert(schema.notifications).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, locationId: run.context.locationId ?? null, channel: "sms", template: `workflow_${w.templateKey ?? "custom"}`, recipient: phone, body, scheduledAt, workflowRunId: run.id, marketing }).returning({ id: schema.notifications.id });
        out.push(row!.id);
        note(i, "queued", `Text queued to ${phone}${deferred}`);
      } else {
        if (!client.emailOptIn || !client.email) { note(i, "skipped", "No email consent or address"); continue; }
        if (marketing && !client.emailMarketingOptIn) { note(i, "skipped", "Unsubscribed from marketing emails"); continue; }
        // A marketing email must show a postal address (CAN-SPAM) and carry an unsubscribe link; a transactional one carries neither,
        // so an aftercare or payment-failed email can't switch off the client's marketing by mistake.
        const address = v.brand.address || (marketing ? await postalAddress(tx, business) : null);
        if (marketing && !address) { note(i, "skipped", NO_POSTAL_ADDRESS); continue; }
        const content = { subject: renderText(step.subject, v.vars), text: renderText(step.body, v.vars), ctaLabel: step.ctaLabel ?? v.ctaLabel, ctaUrl: v.ctaUrl };
        const t = marketing ? marketingEmail({ ...v.brand, address }, { ...content, unsubscribeUrl: unsubscribeUrl(business, client.id) }) : transactionalEmail(v.brand, content);
        const [row] = await tx.insert(schema.notifications).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, locationId: run.context.locationId ?? null, channel: "email", template: `workflow_${w.templateKey ?? "custom"}`, recipient: client.email, subject: t.subject, body: t.html, scheduledAt, workflowRunId: run.id, marketing }).returning({ id: schema.notifications.id });
        out.push(row!.id);
        note(i, "queued", `Email queued to ${client.email}${deferred}`);
      }
      continue;
    }
    if (step.type === "reminder") {
      if (skipNextMessage) { skipNextMessage = false; note(i, "skipped", "Not sent: booked inside the reminder window"); continue; }
      if (!run.appointmentId) { note(i, "skipped", "No appointment to remind about"); continue; }
      const v = await getVars();
      if (!v.apptCtx) { note(i, "skipped", "Appointment no longer exists"); continue; }
      const t = reminderTemplate(v.apptCtx.ctx);
      const phone = normalizePhone(client.phone);
      let any = false;
      if (client.emailOptIn && client.email) {
        const [row] = await tx.insert(schema.notifications).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, locationId: run.context.locationId ?? null, channel: "email", template: "reminder", recipient: client.email, subject: t.subject, body: t.html, scheduledAt: now, workflowRunId: run.id }).returning({ id: schema.notifications.id });
        out.push(row!.id); any = true;
      }
      if (client.smsOptIn && phone) {
        const [row] = await tx.insert(schema.notifications).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, locationId: run.context.locationId ?? null, channel: "sms", template: "reminder", recipient: phone, body: await smsWithStopNotice(tx, client, smsBody(business, "reminder", v.apptCtx.ctx)), scheduledAt: now, workflowRunId: run.id }).returning({ id: schema.notifications.id });
        out.push(row!.id); any = true;
      }
      note(i, any ? "queued" : "skipped", any ? `Reminder queued (${[client.emailOptIn && client.email ? "email" : null, client.smsOptIn && phone ? "text" : null].filter(Boolean).join(" + ")})` : "No channel the client has consented to");
      continue;
    }
    if (step.type === "review_request") {
      if (!run.appointmentId) { note(i, "skipped", "No appointment to rate"); continue; }
      if (client.reviewOptOut) { note(i, "skipped", "Client opted out of rating requests"); continue; }
      const existing = await tx.query.reviews.findFirst({ where: eq(schema.reviews.appointmentId, run.appointmentId) });
      if (existing) { note(i, "skipped", "This visit was already asked"); continue; }
      const v = await getVars();
      if (!v.apptCtx) { note(i, "skipped", "Appointment no longer exists"); continue; }
      const [review] = await tx.insert(schema.reviews).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, staffId: run.context.staffId ?? null, locationId: run.context.locationId ?? null }).returning();
      const url = siteUrl(business, `/review/${review!.token}`);
      const t = reviewRequestTemplate(v.apptCtx.ctx, url);
      const phone = normalizePhone(client.phone);
      if (client.emailOptIn && client.email) {
        const [row] = await tx.insert(schema.notifications).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, locationId: run.context.locationId ?? null, channel: "email", template: "review_request", recipient: client.email, subject: t.subject, body: t.html, scheduledAt: now, workflowRunId: run.id }).returning({ id: schema.notifications.id });
        out.push(row!.id);
        note(i, "queued", `Rating request emailed to ${client.email}`);
      } else if (client.smsOptIn && phone) {
        const scheduledAt = deferToDaytime(now, (await locationTimeZones(tx, business))(run.context.locationId ?? client.homeLocationId));
        const [row] = await tx.insert(schema.notifications).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, locationId: run.context.locationId ?? null, channel: "sms", template: "review_request", recipient: phone, body: await smsWithStopNotice(tx, client, smsBody(business, "review_request", v.apptCtx.ctx, { review_url: url })), scheduledAt, workflowRunId: run.id }).returning({ id: schema.notifications.id });
        out.push(row!.id);
        note(i, "queued", `Rating request texted to ${phone}${scheduledAt > now ? ` (held until ${when(scheduledAt)}, quiet hours)` : ""}`);
      } else note(i, "skipped", "No channel the client has consented to");
      continue;
    }
    if (step.type === "tag") {
      const tag = step.tag.trim();
      if (tag && !client.tags.includes(tag)) {
        await tx.update(schema.clients).set({ tags: [...client.tags, tag] }).where(eq(schema.clients.id, client.id));
        client.tags = [...client.tags, tag];
      }
      note(i, "action", `Tagged “${tag}”`);
      continue;
    }
    if (step.type === "points") {
      await tx.insert(schema.loyaltyLedger).values({ businessId: business.id, clientId: client.id, delta: step.points, reason: "adjust", note: step.note || `Workflow: ${w.name}` });
      note(i, "action", `Gave ${step.points} points`);
      continue;
    }
    if (step.type === "notify_staff") {
      const v = await getVars();
      let to: string | null = null;
      let who = "owner";
      if (step.to === "provider" && run.context.staffId) {
        const s = await tx.query.staff.findFirst({ where: eq(schema.staff.id, run.context.staffId), columns: { email: true, displayName: true } });
        to = s?.email ?? null;
        who = s?.displayName ?? "provider";
      } else {
        to = business.email ?? null;
      }
      if (!to) { note(i, "skipped", `No email address for the ${who}`); continue; }
      const clientName = `${client.firstName} ${client.lastName}`.trim();
      const link = run.appointmentId ? appUrl(`/app/${business.slug}/appointments/${run.appointmentId}`) : appUrl(`/app/${business.slug}/clients/${client.id}`);
      const subject = `${w.name}: ${clientName}`;
      // A client who attached pictures while booking: the team hears about them here, whatever the step's own wording says.
      const photos = run.appointmentId ? clientPhotosLine(v.apptCtx?.ctx.clientPhotos) : null;
      const t = brandedEmail({ ...v.brand, businessName: business.name }, subject, `${textToHtml(renderText(step.body, v.vars))}${photos ? `<p style="margin-top:12px;padding:10px 12px;background:#f5f5f4;border-radius:8px;font-size:14px">${photos.charAt(0).toUpperCase() + photos.slice(1)} are on the appointment.</p>` : ""}<p style="margin-top:16px"><a href="${link}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">${run.appointmentId ? "Open appointment" : "Open client"}</a></p><p style="font-size:12px;color:#78716c">Sent by the “${w.name}” workflow (Automations).</p>`);
      const [row] = await tx.insert(schema.notifications).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, locationId: run.context.locationId ?? null, channel: "email", template: "workflow_staff", recipient: to, subject, body: t, scheduledAt: now, workflowRunId: run.id }).returning({ id: schema.notifications.id });
      out.push(row!.id);
      note(i, "action", `Notified ${who} at ${to}`);
      continue;
    }
  }
  note(null, "done", "Finished");
  await finish("done", i);
}

/** How long the cron's claim on a due run lasts: if the process dies mid-run, the next cron after this picks the run up again. */
const RUN_LEASE_MS = 10 * 60_000;

/**
 * Advance one run in a transaction of its own, so a step that throws rolls back only that run (which is then marked failed, with the
 * error as its last log line, and reported) and the rest of the batch goes on. `fresh` is a run a trigger just started, `lease` the
 * nextAt the cron stamped on a due run when it claimed it; either way the run is left alone when something else moved it meanwhile.
 * Messages it queued go into `out`.
 */
async function advanceOne(business: Business, w: Workflow, runId: string, now: Date, claim: { fresh: true } | { lease: Date }, out: string[]): Promise<"advanced" | "skipped" | "failed"> {
  try {
    const queued = await withTenant(business.id, async (tx) => {
      const [run] = await tx.select().from(schema.workflowRuns).where(and(eq(schema.workflowRuns.id, runId), eq(schema.workflowRuns.status, "active"))).for("update");
      if (!run) return null;
      if ("fresh" in claim ? run.log.length > 1 : run.nextAt?.getTime() !== claim.lease.getTime()) return null;
      const ids: string[] = [];
      await advanceRun(tx, business, w, run, now, ids);
      return ids;
    });
    if (!queued) return "skipped";
    out.push(...queued);
    return "advanced";
  } catch (e) {
    const entry: WorkflowRunLogEntry = { at: new Date().toISOString(), step: null, event: "failed", detail: `Step failed: ${((e as Error).message ?? String(e)).slice(0, 300)}` };
    await withTenant(business.id, (tx) =>
      tx
        .update(schema.workflowRuns)
        .set({ status: "failed", nextAt: null, finishedAt: new Date(), log: sql`${schema.workflowRuns.log} || ${JSON.stringify([entry])}::jsonb` })
        .where(and(eq(schema.workflowRuns.id, runId), eq(schema.workflowRuns.status, "active"))),
    ).catch((e2) => console.error("[workflows] could not mark run failed", runId, (e2 as Error).message));
    await reportError(`workflows: run of “${w.name}” failed`, e, { businessId: business.id, workflowId: w.id, runId });
    return "failed";
  }
}

/** Cron: resume every run whose wait is over, across tenants. One tenant's bad run never holds up another's. */
export async function processWorkflowRuns(now = new Date(), opts: { /** Only these businesses (tests). */ businessIds?: string[] } = {}): Promise<{ businesses: number; resumed: number; queued: number; failed: number }> {
  const due = await withJobs((tx) =>
    tx
      .selectDistinct({ businessId: schema.workflowRuns.businessId })
      .from(schema.workflowRuns)
      .where(and(eq(schema.workflowRuns.status, "active"), lte(schema.workflowRuns.nextAt, now), opts.businessIds ? inArray(schema.workflowRuns.businessId, opts.businessIds) : undefined))
      .limit(500),
  );
  let resumed = 0;
  let queued = 0;
  let failed = 0;
  for (const { businessId } of due) {
    try {
      const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
      if (!business) continue;
      // Claim a batch by stamping a lease on nextAt (skipping runs another cron holds), then advance each in its own transaction.
      const lease = new Date(now.getTime() + RUN_LEASE_MS);
      const claimed = await withTenant(businessId, async (tx) => {
        const candidates = tx.select({ id: schema.workflowRuns.id }).from(schema.workflowRuns).where(and(eq(schema.workflowRuns.status, "active"), lte(schema.workflowRuns.nextAt, now))).orderBy(asc(schema.workflowRuns.nextAt)).limit(200).for("update", { skipLocked: true });
        return tx.update(schema.workflowRuns).set({ nextAt: lease }).where(inArray(schema.workflowRuns.id, candidates)).returning({ id: schema.workflowRuns.id, workflowId: schema.workflowRuns.workflowId });
      });
      const out: string[] = [];
      const flows = new Map<string, Workflow | null>();
      for (const run of claimed) {
        if (!flows.has(run.workflowId)) flows.set(run.workflowId, (await withTenant(businessId, (tx) => tx.query.workflows.findFirst({ where: eq(schema.workflows.id, run.workflowId) }))) ?? null);
        const w = flows.get(run.workflowId);
        if (!w || !w.enabled) { await withTenant(businessId, (tx) => cancelRun(tx, run.id, "Workflow turned off")); continue; }
        const r = await advanceOne(business, w, run.id, now, { lease }, out);
        if (r === "advanced") resumed++;
        else if (r === "failed") failed++;
      }
      queued += out.length;
    } catch (e) {
      failed++;
      await reportError("workflows: resuming a business's runs failed", e, { businessId });
    }
  }
  return { businesses: due.length, resumed, queued, failed };
}

// ---------------------------------------------------------------------------
// Scheduled triggers: birthday and "no visit for N days" (checked in the morning window)
// ---------------------------------------------------------------------------
/** Most runs one scheduled workflow starts per job; the rest start on the next job (the day is only marked done once everyone due has started). */
const SCHEDULED_BATCH = 200;

/**
 * Birthday and "no visit" workflows. Each enabled one is scanned once a day after 9am local (not every 5 minutes): one query finds who is
 * due and hasn't had this workflow for this occasion yet, then their runs start in one transaction and their messages go out together.
 * Suspended businesses are skipped. A no-visit workflow only reaches clients who crossed its threshold in the last week (noVisitWindow).
 * A workflow whose scan throws is reported and tried again next run; the other workflows and businesses carry on.
 */
export async function runScheduledTriggers(now = new Date()): Promise<{ businesses: number; started: number; failed: number }> {
  const enabled = await withJobs((tx) => tx.selectDistinct({ businessId: schema.workflows.businessId }).from(schema.workflows).where(and(eq(schema.workflows.enabled, true), inArray(schema.workflows.trigger, ["birthday", "no_visit"]))));
  let started = 0;
  let failed = 0;
  for (const { businessId } of enabled) {
    try {
      const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
      if (!business || business.suspendedAt) continue;
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: business.timezone, hour: "numeric", hour12: false }).format(now)) % 24;
      if (hour < 9 || hour >= 20) continue;
      const today = instantToISODate(now, business.timezone);
      const flows = await withTenant(businessId, (tx) =>
        tx.select().from(schema.workflows).where(and(eq(schema.workflows.enabled, true), inArray(schema.workflows.trigger, ["birthday", "no_visit"]), or(isNull(schema.workflows.lastScanOn), ne(schema.workflows.lastScanOn, today)))),
      );
      for (const w of flows) {
        try {
          const r = await scanScheduledWorkflow(business, w, now, today);
          started += r.started;
          failed += r.failed;
        } catch (e) {
          failed++;
          await reportError(`workflows: daily scan of “${w.name}” failed`, e, { businessId, workflowId: w.id });
        }
      }
    } catch (e) {
      failed++;
      await reportError("workflows: daily scan for a business failed", e, { businessId });
    }
  }
  return { businesses: enabled.length, started, failed };
}

/** One birthday / no-visit workflow's daily scan: who is due today, their runs started (capped per job), the day marked done. */
async function scanScheduledWorkflow(business: Business, w: Workflow, now: Date, today: string): Promise<{ started: number; failed: number }> {
  const due = await withTenant(business.id, async (tx) => {
    if (w.trigger === "birthday") {
      const rows = await tx.execute<{ client_id: string; tags: string[] }>(sql`
        select c.id as client_id, c.tags from clients c
        where c.birthday is not null and to_char(c.birthday, 'MM-DD') in ${birthdayKeys(today)}
          and not exists (select 1 from workflow_runs wr where wr.workflow_id = ${w.id} and wr.dedupe_key = c.id || ':' || ${today.slice(0, 4)})`);
      return rows.map((r) => ({ clientId: r.client_id, appointmentId: null, dedupeKey: `${r.client_id}:${today.slice(0, 4)}`, tags: r.tags, reason: "Birthday" }));
    }
    const days = w.filters.days ?? 60;
    const win = noVisitWindow(now, days);
    const rows = await tx.execute<{ client_id: string; appointment_id: string; tags: string[] }>(sql`
      select v.client_id, v.appointment_id, c.tags
      from (${lastCompletedVisits()}) v join clients c on c.id = v.client_id
      where v.last_visit > ${win.from.toISOString()}::timestamptz and v.last_visit <= ${win.to.toISOString()}::timestamptz
        and not ${bookedAhead(sql`v.client_id`, sql`now()`)}
        and not exists (select 1 from workflow_runs wr where wr.workflow_id = ${w.id} and wr.dedupe_key = v.client_id || ':' || v.appointment_id)`);
    return rows.map((r) => ({ clientId: r.client_id, appointmentId: null, dedupeKey: `${r.client_id}:${r.appointment_id}`, tags: r.tags, reason: `No visit for ${days} days` }));
  });
  // The window is small (one day of birthdays, one week of lapses), so filters are applied before the batch cap: clients a filter
  // leaves out never hold up the day.
  const matching = due.filter((d) => matchesFilters(w.filters, { clientTags: d.tags }));
  const r = await startScheduledRuns(business, w, matching.slice(0, SCHEDULED_BATCH));
  if (matching.length <= SCHEDULED_BATCH) await withTenant(business.id, (tx) => tx.update(schema.workflows).set({ lastScanOn: today }).where(eq(schema.workflows.id, w.id)));
  return r;
}

/** For the workflow page: how many clients a no-visit workflow would message at its next daily scan (in the window, not yet messaged). */
export async function noVisitReach(business: Business, w: Workflow, now = new Date()): Promise<number> {
  const win = noVisitWindow(now, w.filters.days ?? 60);
  const [row] = await withTenant(business.id, (tx) =>
    tx.execute<{ n: number }>(sql`
      select count(*)::int as n from (${lastCompletedVisits()}) v
      where v.last_visit > ${win.from.toISOString()}::timestamptz and v.last_visit <= ${win.to.toISOString()}::timestamptz
        and not ${bookedAhead(sql`v.client_id`, sql`now()`)}
        and not exists (select 1 from workflow_runs wr where wr.workflow_id = ${w.id} and wr.dedupe_key = v.client_id || ':' || v.appointment_id)`),
  );
  return Number(row?.n ?? 0);
}

/** Start one workflow's runs for many clients (skipping any already started), advance each in its own transaction and send what they queue together. */
async function startScheduledRuns(business: Business, w: Workflow, due: { clientId: string; appointmentId: string | null; dedupeKey: string; tags: string[]; reason: string }[]): Promise<{ started: number; failed: number }> {
  if (!due.length) return { started: 0, failed: 0 };
  const now = new Date();
  const runIds = await withTenant(business.id, async (tx) => {
    const out: string[] = [];
    for (const d of due) {
      const [run] = await tx
        .insert(schema.workflowRuns)
        .values({ businessId: business.id, workflowId: w.id, clientId: d.clientId, appointmentId: d.appointmentId, dedupeKey: d.dedupeKey, nextAt: now, context: { reason: d.reason }, log: [{ at: now.toISOString(), step: null, event: "started", detail: d.reason }] })
        .onConflictDoNothing()
        .returning({ id: schema.workflowRuns.id });
      if (run) out.push(run.id);
    }
    return out;
  });
  let started = 0;
  let failed = 0;
  const ids: string[] = [];
  for (const runId of runIds) {
    const r = await advanceOne(business, w, runId, now, { fresh: true }, ids);
    if (r === "advanced") started++;
    else if (r === "failed") failed++;
  }
  if (ids.length) await deliverMany(business.id, ids).catch((e) => console.error("[workflows] delivery failed", (e as Error).message));
  return { started, failed };
}
