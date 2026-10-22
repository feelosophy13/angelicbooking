/**
 * Pure helpers for workflows (no database): which workflows a trigger fires, which consent
 * each message step needs, when a wait step resumes, quiet-hours deferral, step validation,
 * a run's outcome and the one-line summaries shown on the Automations page. Tested in
 * __tests__/workflows-logic.test.ts.
 */
import type { WorkflowFilters, WorkflowRunLogEntry, WorkflowStep, WorkflowTrigger } from "@angelic/db";

export const TRIGGERS: { key: WorkflowTrigger; label: string; description: string; group: "visit" | "client" | "schedule" }[] = [
  { key: "appointment_booked", label: "Appointment booked", description: "When a visit is booked online or at the desk (also fires for later visits in a series).", group: "visit" },
  { key: "appointment_completed", label: "Visit completed", description: "When a visit is checked out or marked completed.", group: "visit" },
  { key: "appointment_cancelled", label: "Appointment cancelled", description: "When a visit is cancelled by the client or the desk.", group: "visit" },
  { key: "appointment_no_show", label: "No-show", description: "When a visit is marked as a no-show.", group: "visit" },
  { key: "client_created", label: "New client", description: "When a client record is created (online booking, the desk or a shared form).", group: "client" },
  { key: "form_submitted", label: "Form submitted", description: "When a client completes an intake or consent form.", group: "client" },
  { key: "review_submitted", label: "Review received", description: "When a client submits a star rating.", group: "client" },
  { key: "membership_payment_failed", label: "Membership payment failed", description: "When a membership renewal charge fails.", group: "client" },
  { key: "birthday", label: "Birthday", description: "On the client's birthday, once a year (checked each morning).", group: "schedule" },
  { key: "no_visit", label: "No visit for a while", description: "When a client's last completed visit was this many days ago and nothing is booked (checked daily).", group: "schedule" },
];

export const triggerMeta = (key: WorkflowTrigger) => TRIGGERS.find((t) => t.key === key) ?? TRIGGERS[0]!;

// ---------------------------------------------------------------------------
// Consent: marketing or transactional, decided per message step
// ---------------------------------------------------------------------------
/** A text or email about a visit or sign-up that goes out within this many hours of it is part of that transaction, not marketing. */
export const TRANSACTIONAL_WINDOW_HOURS = 72;

/** Hours between the occasion (visit end, sign-up) and `index`, from the waits before it (an "after the visit" wait restarts the clock at the visit). */
export function hoursBeforeStep(steps: WorkflowStep[], index: number): number {
  let hours = 0;
  for (const s of steps.slice(0, index)) {
    if (s.type !== "wait") continue;
    if (s.mode === "after_appointment") hours = Math.max(hours, s.hours);
    else if (s.mode === "delay") hours += s.hours;
  }
  return hours;
}

export interface MessageConsent {
  /** Needs marketing consent (written text consent / not unsubscribed), carries the STOP notice on every text and an unsubscribe link on every email. */
  marketing: boolean;
  /** A text at this step is held until 9am–8pm where the client is. */
  quietHours: boolean;
}

/**
 * Which consent a text or email step needs. Birthday and no-visit messages are always marketing. After a visit or a sign-up, a
 * message within TRANSACTIONAL_WINDOW_HOURS is about that visit (aftercare, a welcome) and needs only appointment-text consent; later
 * steps (a rebook nudge weeks on) are marketing. Every other trigger is about something the client did or that happened to their
 * account, so it is transactional. Quiet hours apply to every text except the reminder and the booked / cancelled confirmations,
 * which the client expects at once.
 */
export function messageConsent(trigger: WorkflowTrigger, steps: WorkflowStep[], index: number): MessageConsent {
  const marketing =
    trigger === "birthday" || trigger === "no_visit"
      ? true
      : trigger === "appointment_completed" || trigger === "client_created"
        ? hoursBeforeStep(steps, index) > TRANSACTIONAL_WINDOW_HOURS
        : false;
  const quietHours = trigger !== "appointment_booked" && trigger !== "appointment_cancelled";
  return { marketing, quietHours };
}

/** The one line under a text or email step in the editor: which consent it needs and when it can go. */
export function consentLine(step: WorkflowStep, trigger: WorkflowTrigger, steps: WorkflowStep[], index: number): string | null {
  if (step.type !== "sms" && step.type !== "email") return null;
  const c = messageConsent(trigger, steps, index);
  if (step.type === "sms") {
    if (c.marketing) return "Marketing text: needs the client's written consent to marketing texts, carries “Reply STOP to opt out”, sent 9am–8pm.";
    return c.quietHours ? "Appointment text: needs text consent only; sent 9am–8pm. A STOP reply still opts the client out." : "Appointment text: needs text consent only and goes out right away. A STOP reply still opts the client out.";
  }
  return c.marketing ? "Marketing email: skipped for clients who unsubscribed; carries an unsubscribe link and your postal address." : "Transactional email: needs email consent only, no unsubscribe link.";
}

/** Triggers that carry an appointment, so relative waits ("24 hours before") make sense. */
export const APPOINTMENT_TRIGGERS: WorkflowTrigger[] = ["appointment_booked", "appointment_completed", "appointment_cancelled", "appointment_no_show"];

/** Placeholders available to message steps, by trigger. */
export function placeholdersFor(trigger: WorkflowTrigger): string[] {
  const base = ["{first_name}", "{business}", "{booking_url}", "{referral_code}"];
  if (APPOINTMENT_TRIGGERS.includes(trigger)) return [...base, "{service}", "{staff}", "{when}", "{manage_url}", "{forms_url}", "{review_url}"];
  if (trigger === "review_submitted") return [...base, "{rating}", "{comment}", "{staff}", "{service}"];
  if (trigger === "form_submitted") return [...base, "{form}"];
  if (trigger === "membership_payment_failed") return [...base, "{membership}"];
  return base;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
export interface TriggerFacts {
  serviceIds?: string[];
  /** Category of each service in the visit, plus every ancestor category. */
  categoryIds?: string[];
  locationId?: string | null;
  staffId?: string | null;
  clientTags?: string[];
  rating?: number | null;
  /** True when this is the client's first visit (booked or completed), or a brand-new client. */
  firstVisit?: boolean;
  /** How the appointment was made. */
  source?: "staff" | "online" | "import" | null;
}

/** Does a trigger occurrence pass the workflow's filters? Unset filters match everything. */
export function matchesFilters(f: WorkflowFilters | null | undefined, facts: TriggerFacts): boolean {
  if (!f) return true;
  const any = (want?: string[] | null, have?: string[] | null) => !want?.length || (have ?? []).some((x) => want.includes(x));
  if (!any(f.serviceIds, facts.serviceIds)) return false;
  if (!any(f.categoryIds, facts.categoryIds)) return false;
  if (f.locationIds?.length && !(facts.locationId && f.locationIds.includes(facts.locationId))) return false;
  if (f.staffIds?.length && !(facts.staffId && f.staffIds.includes(facts.staffId))) return false;
  if (!any(f.tags, facts.clientTags)) return false;
  if (f.minRating != null && (facts.rating == null || facts.rating < f.minRating)) return false;
  if (f.maxRating != null && (facts.rating == null || facts.rating > f.maxRating)) return false;
  if (f.firstVisitOnly && !facts.firstVisit) return false;
  if (f.onlineOnly && facts.source !== "online") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------
export const QUIET_START_HOUR = 9;
export const QUIET_END_HOUR = 20;

function localParts(at: Date, timeZone: string): { hour: number; minute: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return { hour: Number(get("hour")) % 24, minute: Number(get("minute")), date: `${get("year")}-${get("month")}-${get("day")}` };
}

/**
 * Quiet hours: texts (other than the reminder and the booked / cancelled confirmations) and marketing emails only go out between 9am
 * and 8pm where the client is. Returns `at` when it is inside the window, else the next 9am.
 */
export function deferToDaytime(at: Date, timeZone: string): Date {
  const { hour, minute } = localParts(at, timeZone);
  if (hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR) return at;
  // Minutes until the next 9:00 local: either later today (before 9) or tomorrow (after 20).
  const minutesNow = hour * 60 + minute;
  const target = QUIET_START_HOUR * 60;
  const delta = minutesNow < target ? target - minutesNow : 24 * 60 - minutesNow + target;
  return new Date(at.getTime() + delta * 60_000);
}

/** When a wait step resumes. Relative waits need the appointment's current start/end; null when they can't be computed. */
export function waitResumesAt(step: Extract<WorkflowStep, { type: "wait" }>, now: Date, appt?: { startAt: Date; endAt: Date } | null): Date | null {
  const ms = Math.max(0, step.hours) * 3_600_000;
  if (step.mode === "delay") return new Date(now.getTime() + ms);
  if (!appt) return null;
  return step.mode === "before_appointment" ? new Date(appt.startAt.getTime() - ms) : new Date(appt.endAt.getTime() + ms);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
export const STEP_LABELS: Record<WorkflowStep["type"], string> = {
  wait: "Wait",
  reminder: "Send the appointment reminder",
  sms: "Send a text",
  email: "Send an email",
  review_request: "Ask for a rating",
  tag: "Add a tag",
  points: "Give loyalty points",
  notify_staff: "Notify staff",
};

export function newStepId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Problems with a step list, in plain words. Empty = valid. */
export function validateSteps(steps: WorkflowStep[], trigger: WorkflowTrigger): string[] {
  const errors: string[] = [];
  if (!steps.length) errors.push("Add at least one step.");
  const hasAppt = APPOINTMENT_TRIGGERS.includes(trigger);
  steps.forEach((s, i) => {
    const n = `Step ${i + 1}`;
    if (s.type === "wait") {
      if (!(s.hours >= 0) || s.hours > 24 * 365) errors.push(`${n}: enter a wait between 0 and 8,760 hours.`);
      if (s.mode !== "delay" && !hasAppt) errors.push(`${n}: "before/after the appointment" needs an appointment trigger.`);
      if (s.mode === "before_appointment" && trigger !== "appointment_booked") errors.push(`${n}: "before the appointment" only works with the Appointment booked trigger.`);
    }
    if (s.type === "sms" && !s.body.trim()) errors.push(`${n}: the text message is empty.`);
    if (s.type === "email" && (!s.subject.trim() || (!s.body.trim() && !s.templateId))) errors.push(`${n}: the email needs a subject and a message.`);
    if (s.type === "review_request" && trigger !== "appointment_completed") errors.push(`${n}: a rating request needs the Visit completed trigger.`);
    if (s.type === "reminder" && trigger !== "appointment_booked") errors.push(`${n}: the appointment reminder needs the Appointment booked trigger.`);
    if (s.type === "tag" && !s.tag.trim()) errors.push(`${n}: enter a tag.`);
    if (s.type === "points" && !(s.points > 0 && s.points <= 100_000)) errors.push(`${n}: enter the points to give (1 to 100,000).`);
    if (s.type === "notify_staff" && !s.body.trim()) errors.push(`${n}: the staff note is empty.`);
    if (s.type === "notify_staff" && s.to === "provider" && !hasAppt) errors.push(`${n}: notifying the provider needs an appointment trigger.`);
  });
  return errors;
}

/** "Wait 48 h before the appointment → text + email" for the card list. */
export function summarizeSteps(steps: WorkflowStep[]): string {
  const hours = (h: number) => (h % 24 === 0 && h >= 24 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} h`);
  const parts: string[] = [];
  for (const s of steps) {
    if (s.type === "wait") parts.push(s.mode === "delay" ? `wait ${hours(s.hours)}` : s.mode === "before_appointment" ? `${hours(s.hours)} before the visit` : `${hours(s.hours)} after the visit`);
    else if (s.type === "sms") parts.push("text");
    else if (s.type === "email") parts.push("email");
    else if (s.type === "review_request") parts.push("rating request");
    else if (s.type === "reminder") parts.push("appointment reminder");
    else if (s.type === "tag") parts.push(`tag “${s.tag}”`);
    else if (s.type === "points") parts.push(`+${s.points} points`);
    else parts.push(`notify ${s.to}`);
  }
  // Merge "text, email" neighbours into "text + email".
  return parts.join(" → ").replace(/text → email/g, "text + email").replace(/email → text/g, "email + text");
}

// ---------------------------------------------------------------------------
// Run outcome
// ---------------------------------------------------------------------------
export type RunOutcome = "active" | "queued" | "sent" | "skipped" | "failed" | "cancelled" | "done";

/**
 * What a run amounted to, for its badge: in progress, cancelled or failed as is; a finished run is "failed" when a message could not
 * be sent, "sent" when one went out, "queued" while a message it handed to delivery has not been tried yet, "skipped" when every
 * message was skipped (no consent, STOP, trial cap …), and "done" when it had no messages (tags, points, staff notes). Delivery
 * appends what it did to the log (entries without a step), which is how a run stops reading "queued".
 */
export function runOutcome(run: { status: "active" | "done" | "cancelled" | "failed"; log: WorkflowRunLogEntry[] }): RunOutcome {
  if (run.status !== "done") return run.status;
  const events = new Set(run.log.map((l) => l.event));
  if (events.has("failed")) return "failed";
  if (events.has("sent")) return "sent";
  const queued = run.log.filter((l) => l.event === "queued").length;
  const tried = run.log.filter((l) => l.step == null && (l.event === "sent" || l.event === "skipped" || l.event === "failed")).length;
  if (queued > tried) return "queued";
  if (events.has("skipped")) return "skipped";
  return "done";
}

/**
 * Who a "no visit for N days" workflow reaches today: clients whose last visit is between N and N+7 days ago. Only people who crossed the
 * line recently, so turning it on (or importing years of history) never messages every client who ever lapsed; a week of slack covers
 * days the job didn't run. The dedupe key (client + last visit) keeps it to once per lapse.
 */
export const NO_VISIT_WINDOW_DAYS = 7;
export function noVisitWindow(now: Date, days: number): { from: Date; to: Date } {
  const day = 86_400_000;
  return { from: new Date(now.getTime() - (days + NO_VISIT_WINDOW_DAYS) * day), to: new Date(now.getTime() - days * day) };
}

/** Birthdays to celebrate on a local date (YYYY-MM-DD) as "MM-DD": 29 February birthdays are on the 28th in years without one. */
export function birthdayKeys(today: string): string[] {
  const md = today.slice(5);
  const year = Number(today.slice(0, 4));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return md === "02-28" && !leap ? ["02-28", "02-29"] : [md];
}
