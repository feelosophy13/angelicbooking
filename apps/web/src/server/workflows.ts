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
 * - Guardrails that are never configurable: consent per channel, STOP notice on
 *   marketing texts, quiet hours (9am–8pm local) for marketing triggers, one run per
 *   occasion, review requests only once per visit.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, schema, withJobs, withTenant, type TenantDb, type WorkflowFilters, type WorkflowRunContext, type WorkflowRunLogEntry, type WorkflowStep, type WorkflowTrigger } from "@angelic/db";
import { instantToISODate, normalizePhone } from "@angelic/core";
import { appUrl } from "@/lib/stripe";
import { appointmentContext, deliverMany } from "@/lib/notify";
import { brandedEmail, marketingEmail, reviewRequestTemplate, templates as messageTemplates, textToHtml } from "@/lib/notify/templates";
const reminderTemplate = messageTemplates.reminder;
import { smsBody, smsWithStopNotice } from "@/lib/notify/sms";
import { appointmentVars, renderText, unsubscribeUrl } from "@/server/marketing";
import { pathTo } from "@/server/categories";
import { ensureReferralCode, referralsEnabled } from "./loyalty";
import { locationTimeZones, NO_POSTAL_ADDRESS, postalAddress } from "./locations";
import { siteUrl } from "@/lib/site-url";
import { APPOINTMENT_TRIGGERS, birthdayKeys, deferToDaytime, isMarketingTrigger, matchesFilters, newStepId, noVisitWindow, validateSteps, waitResumesAt, type TriggerFacts } from "@/lib/workflows-logic";

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
    { type: "sms", body: "{business}: thanks for coming in! To keep your {service} looking its best, avoid washing for 48 hours and use a sulphate-free shampoo. Questions? Just reply." },
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
        if (t.key === "pre_visit") steps = [{ id: newStepId(), type: "wait", mode: "before_appointment", hours: old.hoursBefore }, ...msgs];
        else if (t.key === "rebook") steps = [{ id: newStepId(), type: "wait", mode: "delay", hours: old.days * 24 }, ...msgs];
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
  const [prior] = appt.clientId
    ? await tx.select({ n: sql<number>`count(*)` }).from(schema.appointments).where(and(eq(schema.appointments.clientId, appt.clientId), ne(schema.appointments.id, appt.id), eq(schema.appointments.kind, "visit"), inArray(schema.appointments.status, ["completed", "checked_in", "confirmed", "booked"])))
    : [{ n: 0 }];
  return { clientId: appt.clientId, locationId: appt.locationId, staffId: use[0]?.staffId ?? null, serviceIds, categoryIds, clientTags: client?.tags ?? [], firstVisit: Number(prior?.n ?? 0) === 0, source: appt.source };
}

/**
 * Start runs for every enabled workflow on `trigger` whose filters match, then advance
 * them right away (so delay-less steps send immediately). Delivery happens after the
 * caller's response via the returned promise, or on the next cron run regardless.
 */
export async function triggerWorkflows(business: Business, trigger: WorkflowTrigger, input: TriggerInput): Promise<number> {
  // A business that has never opened Automations still gets the defaults (e.g. rating requests), and one that
  // has gets any template added since (it is a no-op once they all exist).
  await ensureTemplates(business);
  const ids = await withTenant(business.id, async (tx) => {
    const flows = await tx.select().from(schema.workflows).where(and(eq(schema.workflows.trigger, trigger), eq(schema.workflows.enabled, true)));
    if (!flows.length) return [];
    const facts = input.facts ?? {};
    const notifIds: string[] = [];
    const now = new Date();
    for (const w of flows) {
      if (input.onlyWorkflowIds && !input.onlyWorkflowIds.includes(w.id)) continue;
      if (!matchesFilters(w.filters, facts)) continue;
      const [run] = await tx
        .insert(schema.workflowRuns)
        .values({ businessId: business.id, workflowId: w.id, clientId: input.clientId, appointmentId: input.appointmentId ?? null, dedupeKey: input.dedupeKey, context: { ...input.context, locationId: facts.locationId ?? input.context?.locationId ?? null, staffId: facts.staffId ?? input.context?.staffId ?? null, serviceIds: facts.serviceIds, categoryIds: facts.categoryIds }, log: [{ at: now.toISOString(), step: null, event: "started", detail: input.context?.reason ?? triggerLabel(trigger) }] })
        .onConflictDoNothing()
        .returning();
      if (!run) continue;
      await advanceRun(tx, business, w, run, now, notifIds);
    }
    return notifIds;
  });
  if (ids.length) void deliverMany(business.id, ids).catch((e) => console.error("[workflows] delivery failed", (e as Error).message));
  return ids.length;
}

const triggerLabel = (t: WorkflowTrigger) => ({ appointment_booked: "Appointment booked", appointment_completed: "Visit completed", appointment_cancelled: "Appointment cancelled", appointment_no_show: "No-show", client_created: "New client", form_submitted: "Form submitted", review_submitted: "Review received", membership_payment_failed: "Membership payment failed", birthday: "Birthday", no_visit: "No recent visit" })[t];

/** Appointment-driven triggers in one call (used by the booking, status and checkout paths). */
export async function triggerAppointmentWorkflows(business: Business, trigger: Extract<WorkflowTrigger, `appointment_${string}`>, appointmentId: string) {
  const [facts, times] = await withTenant(business.id, async (tx) => [await appointmentFacts(tx, appointmentId), await appointmentTimes(tx, appointmentId)] as const);
  if (!facts || !facts.clientId) return 0;
  // "Booked" flows are per time slot: moving the appointment starts them again for the new time.
  const dedupeKey = trigger === "appointment_booked" && times ? `${appointmentId}:${times.startAt.getTime()}` : appointmentId;
  return triggerWorkflows(business, trigger, { clientId: facts.clientId, appointmentId, dedupeKey, facts, context: { appointmentId, reason: triggerLabel(trigger) } });
}

/** Cancel runs: everything active for a workflow, an appointment, or a client. */
async function cancelRuns(tx: TenantDb, by: { workflowId?: string; appointmentId?: string; clientId?: string }, reason: string) {
  const conds = [eq(schema.workflowRuns.status, "active")];
  if (by.workflowId) conds.push(eq(schema.workflowRuns.workflowId, by.workflowId));
  if (by.appointmentId) conds.push(eq(schema.workflowRuns.appointmentId, by.appointmentId));
  if (by.clientId) conds.push(eq(schema.workflowRuns.clientId, by.clientId));
  const runs = await tx.select().from(schema.workflowRuns).where(and(...conds));
  for (const r of runs) {
    await tx.update(schema.workflowRuns).set({ status: "cancelled", finishedAt: new Date(), nextAt: null, log: [...r.log, { at: new Date().toISOString(), step: r.stepIndex, event: "cancelled", detail: reason }] }).where(eq(schema.workflowRuns.id, r.id));
    // Anything queued but not yet sent by this run goes with it.
    await tx.update(schema.notifications).set({ status: "cancelled", error: reason }).where(and(eq(schema.notifications.workflowRunId, r.id), eq(schema.notifications.status, "queued")));
  }
}

/**
 * The appointment moved or was cancelled: runs waiting on it are re-timed or dropped.
 * Called from the same places that move / drop the standard reminder.
 */
export async function resyncAppointmentRuns(business: Business, appointmentId: string, change: "rescheduled" | "cancelled") {
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

/** Stop "until they book again" runs for a client who just booked. */
export async function noteClientBooked(business: Business, clientId: string) {
  await withTenant(business.id, async (tx) => {
    const runs = await tx.select({ id: schema.workflowRuns.id, workflowId: schema.workflowRuns.workflowId }).from(schema.workflowRuns).where(and(eq(schema.workflowRuns.clientId, clientId), eq(schema.workflowRuns.status, "active")));
    for (const r of runs) {
      const w = await tx.query.workflows.findFirst({ where: eq(schema.workflows.id, r.workflowId), columns: { exitOnBooking: true } });
      if (w?.exitOnBooking) await cancelRuns(tx, { clientId, workflowId: r.workflowId }, "Client booked again");
    }
  });
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

/**
 * Execute steps from the run's current index until a wait stops it or it finishes.
 * Appends to the run log and queues notifications (ids collected in `out`).
 */
async function advanceRun(tx: TenantDb, business: Business, w: Workflow, run: WorkflowRun, now: Date, out: string[]) {
  const log: WorkflowRunLogEntry[] = [...run.log];
  const note = (step: number | null, event: WorkflowRunLogEntry["event"], detail: string) => log.push({ at: new Date().toISOString(), step, event, detail });
  const finish = async (status: "done" | "cancelled", stepIndex: number, nextAt: Date | null = null) => {
    await tx.update(schema.workflowRuns).set({ status, stepIndex, nextAt, finishedAt: new Date(), log }).where(eq(schema.workflowRuns.id, run.id));
  };
  const client = run.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, run.clientId) }) : null;
  if (!client) { note(null, "cancelled", "Client no longer exists"); await finish("cancelled", run.stepIndex); return; }
  const marketing = isMarketingTrigger(w.trigger);
  let i = run.stepIndex;
  let vars: Awaited<ReturnType<typeof varsFor>> | null = null;
  const getVars = async () => (vars ??= await varsFor(tx, business, w, run, client));
  // Set when a "before the appointment" wait was already past the first time it was reached (booked inside the reminder window): the
  // message right after it is skipped, since the confirmation just went out; a run resuming after its wait is not affected.
  let skipNextMessage = false;
  for (; i < w.steps.length; i++) {
    const step = w.steps[i]!;
    // Guards before every step.
    if (run.appointmentId && w.trigger === "appointment_booked") {
      const t = await appointmentTimes(tx, run.appointmentId);
      if (!t || t.status === "cancelled" || t.status === "no_show") { note(i, "cancelled", "Appointment cancelled"); await finish("cancelled", i); return; }
    }
    if (w.exitOnBooking && step.type !== "wait") {
      const [up] = await tx.select({ n: sql<number>`count(*)` }).from(schema.appointments).innerJoin(schema.appointmentItems, eq(schema.appointmentItems.appointmentId, schema.appointments.id)).where(and(eq(schema.appointments.clientId, client.id), inArray(schema.appointments.status, ["booked", "confirmed"]), gte(schema.appointmentItems.startAt, now), gte(schema.appointments.createdAt, run.startedAt)));
      if (Number(up?.n ?? 0) > 0) { note(i, "cancelled", "Client booked again"); await finish("cancelled", i); return; }
    }
    if (step.type === "wait") {
      const times = run.appointmentId ? await appointmentTimes(tx, run.appointmentId) : null;
      const at = waitResumesAt(step, now, times);
      if (!at) { note(i, "skipped", "No appointment to time this wait from"); continue; }
      const resuming = i === run.stepIndex && !!run.nextAt && run.nextAt <= now;
      if (step.mode === "before_appointment" && at <= now && !resuming) {
        skipNextMessage = true;
        note(i, "skipped", "Booked inside this window: the confirmation covers it");
        continue;
      }
      if (at > now) {
        note(i, "waiting", `Resumes ${at.toISOString()}`);
        await tx.update(schema.workflowRuns).set({ stepIndex: i, nextAt: at, log }).where(eq(schema.workflowRuns.id, run.id));
        return;
      }
      continue;
    }
    if (step.type === "sms" || step.type === "email") {
      if (skipNextMessage) { skipNextMessage = false; note(i, "skipped", "Not sent: booked inside the reminder window"); continue; }
      const v = await getVars();
      // Quiet hours where the client is: the visit's location, else their usual one.
      const zone = (await locationTimeZones(tx, business))(run.context.locationId ?? client?.homeLocationId);
      const scheduledAt = marketing ? deferToDaytime(now, zone) : now;
      const deferred = scheduledAt > now ? ` (held until ${scheduledAt.toISOString()}, quiet hours)` : "";
      if (step.type === "sms") {
        const phone = normalizePhone(client.phone);
        if (!client.smsOptIn || !phone) { note(i, "skipped", "No text consent or number"); continue; }
        if (marketing && !client.smsMarketingOptIn) { note(i, "skipped", "No consent to marketing texts"); continue; }
        // Texts start with the business's name; a template that already does (e.g. "{business}: ...") isn't prefixed twice.
        const text = renderText(step.body, v.vars);
        const body = await smsWithStopNotice(tx, client, text.startsWith(`${v.brand.businessName}:`) ? text : `${v.brand.businessName}: ${text}`, marketing);
        const [row] = await tx.insert(schema.notifications).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, locationId: run.context.locationId ?? null, channel: "sms", template: `workflow_${w.templateKey ?? "custom"}`, recipient: phone, body, scheduledAt, workflowRunId: run.id, marketing }).returning({ id: schema.notifications.id });
        out.push(row!.id);
        note(i, "sent", `Text queued to ${phone}${deferred}`);
      } else {
        if (!client.emailOptIn || !client.email) { note(i, "skipped", "No email consent or address"); continue; }
        if (marketing && !client.emailMarketingOptIn) { note(i, "skipped", "Unsubscribed from marketing emails"); continue; }
        // A marketing email must show a postal address (CAN-SPAM).
        const address = v.brand.address || (marketing ? await postalAddress(tx, business) : null);
        if (marketing && !address) { note(i, "skipped", NO_POSTAL_ADDRESS); continue; }
        const t = marketingEmail({ ...v.brand, address }, { subject: renderText(step.subject, v.vars), text: renderText(step.body, v.vars), ctaLabel: step.ctaLabel ?? v.ctaLabel, ctaUrl: v.ctaUrl, unsubscribeUrl: unsubscribeUrl(business, client.id) });
        const [row] = await tx.insert(schema.notifications).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, locationId: run.context.locationId ?? null, channel: "email", template: `workflow_${w.templateKey ?? "custom"}`, recipient: client.email, subject: t.subject, body: t.html, scheduledAt, workflowRunId: run.id, marketing }).returning({ id: schema.notifications.id });
        out.push(row!.id);
        note(i, "sent", `Email queued to ${client.email}${deferred}`);
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
      note(i, any ? "sent" : "skipped", any ? `Reminder queued (${[client.emailOptIn && client.email ? "email" : null, client.smsOptIn && phone ? "text" : null].filter(Boolean).join(" + ")})` : "No channel the client has consented to");
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
        note(i, "sent", `Rating request emailed to ${client.email}`);
      } else if (client.smsOptIn && phone) {
        const [row] = await tx.insert(schema.notifications).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, locationId: run.context.locationId ?? null, channel: "sms", template: "review_request", recipient: phone, body: await smsWithStopNotice(tx, client, smsBody(business, "review_request", v.apptCtx.ctx, { review_url: url })), scheduledAt: deferToDaytime(now, (await locationTimeZones(tx, business))(run.context.locationId ?? client.homeLocationId)), workflowRunId: run.id }).returning({ id: schema.notifications.id });
        out.push(row!.id);
        note(i, "sent", `Rating request texted to ${phone} (held for daytime if it's late)`);
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
      const t = brandedEmail({ ...v.brand, businessName: business.name }, subject, `${textToHtml(renderText(step.body, v.vars))}<p style="margin-top:16px"><a href="${link}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">${run.appointmentId ? "Open appointment" : "Open client"}</a></p><p style="font-size:12px;color:#78716c">Sent by the “${w.name}” workflow (Automations).</p>`);
      const [row] = await tx.insert(schema.notifications).values({ businessId: business.id, clientId: client.id, appointmentId: run.appointmentId, locationId: run.context.locationId ?? null, channel: "email", template: "workflow_staff", recipient: to, subject, body: t, scheduledAt: now, workflowRunId: run.id }).returning({ id: schema.notifications.id });
      out.push(row!.id);
      note(i, "action", `Notified ${who} at ${to}`);
      continue;
    }
  }
  note(null, "done", "Finished");
  await finish("done", i);
}

/** Cron: resume every run whose wait is over, across tenants. */
export async function processWorkflowRuns(now = new Date()): Promise<{ businesses: number; resumed: number; queued: number }> {
  const due = await withJobs((tx) => tx.selectDistinct({ businessId: schema.workflowRuns.businessId }).from(schema.workflowRuns).where(and(eq(schema.workflowRuns.status, "active"), lte(schema.workflowRuns.nextAt, now))).limit(500));
  let resumed = 0;
  let queued = 0;
  for (const { businessId } of due) {
    const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
    if (!business) continue;
    const ids = await withTenant(businessId, async (tx) => {
      const out: string[] = [];
      const candidates = tx.select({ id: schema.workflowRuns.id }).from(schema.workflowRuns).where(and(eq(schema.workflowRuns.status, "active"), lte(schema.workflowRuns.nextAt, now))).orderBy(asc(schema.workflowRuns.nextAt)).limit(200).for("update", { skipLocked: true });
      const runs = await tx.select().from(schema.workflowRuns).where(inArray(schema.workflowRuns.id, candidates));
      for (const run of runs) {
        const w = await tx.query.workflows.findFirst({ where: eq(schema.workflows.id, run.workflowId) });
        if (!w || !w.enabled) { await cancelRuns(tx, { workflowId: run.workflowId }, "Workflow turned off"); continue; }
        // Mark the wait as passed before executing the rest of the steps.
        const resumedRun = { ...run, stepIndex: w.steps[run.stepIndex]?.type === "wait" ? run.stepIndex + 1 : run.stepIndex };
        await advanceRun(tx, business, w, resumedRun, now, out);
        resumed++;
      }
      return out;
    });
    queued += ids.length;
  }
  return { businesses: due.length, resumed, queued };
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
 */
export async function runScheduledTriggers(now = new Date()): Promise<{ businesses: number; started: number }> {
  const enabled = await withJobs((tx) => tx.selectDistinct({ businessId: schema.workflows.businessId }).from(schema.workflows).where(and(eq(schema.workflows.enabled, true), inArray(schema.workflows.trigger, ["birthday", "no_visit"]))));
  let started = 0;
  for (const { businessId } of enabled) {
    const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
    if (!business || business.suspendedAt) continue;
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: business.timezone, hour: "numeric", hour12: false }).format(now)) % 24;
    if (hour < 9 || hour >= 20) continue;
    const today = instantToISODate(now, business.timezone);
    const flows = await withTenant(businessId, (tx) =>
      tx.select().from(schema.workflows).where(and(eq(schema.workflows.enabled, true), inArray(schema.workflows.trigger, ["birthday", "no_visit"]), or(isNull(schema.workflows.lastScanOn), ne(schema.workflows.lastScanOn, today)))),
    );
    for (const w of flows) {
      const due = await withTenant(businessId, async (tx) => {
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
          from (
            select distinct on (a.client_id) a.client_id, a.id as appointment_id, i.start_at as last_visit
            from appointments a join appointment_items i on i.appointment_id = a.id and i.sort_order = 0
            where a.status = 'completed' and a.client_id is not null
            order by a.client_id, i.start_at desc
          ) v join clients c on c.id = v.client_id
          where v.last_visit > ${win.from.toISOString()}::timestamptz and v.last_visit <= ${win.to.toISOString()}::timestamptz
            and not exists (select 1 from appointments a2 join appointment_items i2 on i2.appointment_id = a2.id
                            where a2.client_id = v.client_id and a2.status in ('booked','confirmed') and i2.start_at > now())
            and not exists (select 1 from workflow_runs wr where wr.workflow_id = ${w.id} and wr.dedupe_key = v.client_id || ':' || v.appointment_id)`);
        return rows.map((r) => ({ clientId: r.client_id, appointmentId: null, dedupeKey: `${r.client_id}:${r.appointment_id}`, tags: r.tags, reason: `No visit for ${days} days` }));
      });
      // The window is small (one day of birthdays, one week of lapses), so filters are applied before the batch cap: clients a filter
      // leaves out never hold up the day.
      const matching = due.filter((d) => matchesFilters(w.filters, { clientTags: d.tags }));
      started += await startScheduledRuns(business, w, matching.slice(0, SCHEDULED_BATCH));
      if (matching.length <= SCHEDULED_BATCH) await withTenant(businessId, (tx) => tx.update(schema.workflows).set({ lastScanOn: today }).where(eq(schema.workflows.id, w.id)));
    }
  }
  return { businesses: enabled.length, started };
}

/** For the workflow page: how many clients a no-visit workflow would message at its next daily scan (in the window, not yet messaged). */
export async function noVisitReach(business: Business, w: Workflow, now = new Date()): Promise<number> {
  const win = noVisitWindow(now, w.filters.days ?? 60);
  const [row] = await withTenant(business.id, (tx) =>
    tx.execute<{ n: number }>(sql`
      select count(*)::int as n from (
        select distinct on (a.client_id) a.client_id, a.id as appointment_id, i.start_at as last_visit
        from appointments a join appointment_items i on i.appointment_id = a.id and i.sort_order = 0
        where a.status = 'completed' and a.client_id is not null
        order by a.client_id, i.start_at desc
      ) v
      where v.last_visit > ${win.from.toISOString()}::timestamptz and v.last_visit <= ${win.to.toISOString()}::timestamptz
        and not exists (select 1 from appointments a2 join appointment_items i2 on i2.appointment_id = a2.id
                        where a2.client_id = v.client_id and a2.status in ('booked','confirmed') and i2.start_at > now())
        and not exists (select 1 from workflow_runs wr where wr.workflow_id = ${w.id} and wr.dedupe_key = v.client_id || ':' || v.appointment_id)`),
  );
  return Number(row?.n ?? 0);
}

/** Start one workflow's runs for many clients in one transaction (skipping any already started) and send what they queue together. */
async function startScheduledRuns(business: Business, w: Workflow, due: { clientId: string; appointmentId: string | null; dedupeKey: string; tags: string[]; reason: string }[]): Promise<number> {
  if (!due.length) return 0;
  const now = new Date();
  const ids = await withTenant(business.id, async (tx) => {
    const out: string[] = [];
    for (const d of due) {
      const [run] = await tx
        .insert(schema.workflowRuns)
        .values({ businessId: business.id, workflowId: w.id, clientId: d.clientId, appointmentId: d.appointmentId, dedupeKey: d.dedupeKey, context: { reason: d.reason }, log: [{ at: now.toISOString(), step: null, event: "started", detail: d.reason }] })
        .onConflictDoNothing()
        .returning();
      if (run) await advanceRun(tx, business, w, run, now, out);
    }
    return out;
  });
  if (ids.length) await deliverMany(business.id, ids).catch((e) => console.error("[workflows] delivery failed", (e as Error).message));
  return ids.length;
}

// keep helpers referenced for future steps
void isNull;
