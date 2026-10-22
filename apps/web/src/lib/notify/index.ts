import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { db, schema, withJobs, withTenant, type TenantDb } from "@angelic/db";
import { normalizePhone, lateCancelFeeLabel, policyFeeCheck } from "@angelic/core";
import { appUrl } from "@/lib/stripe";
import { formatMoney } from "@/lib/utils";
import { formsForAppointment } from "@/server/forms";
import { clientPhotoCounts } from "@/server/visit-photos";
import { isDemoSlug } from "@/lib/demo";
import { EmailRateLimitError, emailConfigured, emailTurn, sendEmail, sendSms, smsConfigured, type SmsSender } from "./providers";
import { platformSmsSender, TwilioError } from "@/lib/twilio";
import { phoneTail, suppressedTails, suppressSms } from "@/server/consent";
import { oneClickUnsubscribeUrl } from "@/lib/unsubscribe";
import { listNumbers } from "@/server/messaging";
import { addressOf, tzFor } from "@/server/locations";
import { billingEnabled, reportSmsUsage } from "@/server/billing";
import { businessAccess, publishBlockedReason } from "@/server/access";
import { emailDailyCap } from "@/lib/access";
import { smsPausedReason } from "@/lib/billing-config";
import { priceBookIn } from "@/server/price-book";
import { templates, type ApptContext, type TemplateName } from "./templates";
import { siteUrl } from "@/lib/site-url";
import { smsBody, smsWithStopNotice } from "./sms";
import { apptVars, designedEmail } from "@/server/email-designs";

type Row = typeof schema.notifications.$inferSelect;

/** Build the template context for an appointment (must run inside the tenant tx). */
export async function appointmentContext(tx: TenantDb, business: typeof schema.businesses.$inferSelect, appointmentId: string) {
  const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId) });
  if (!appt) return null;
  const items = await tx
    .select({ name: schema.appointmentItems.serviceName, startAt: schema.appointmentItems.startAt, staffName: schema.staff.displayName, status: schema.appointmentItems.status, serviceId: schema.appointmentItems.serviceId })
    .from(schema.appointmentItems)
    .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
    .where(eq(schema.appointmentItems.appointmentId, appointmentId))
    .orderBy(asc(schema.appointmentItems.startAt));
  const live = items.filter((i) => i.status !== "cancelled");
  const use = live.length ? live : items;
  if (!use.length) return null;
  const prepNotes = await prepNotesFor(tx, use.map((i) => i.serviceId).filter((x): x is string => !!x));
  const client = appt.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, appt.clientId) }) : null;
  // Messages speak for the location of the visit: its phone, address and clock.
  const location = appt.locationId ? await tx.query.locations.findFirst({ where: eq(schema.locations.id, appt.locationId) }) : null;
  // A location with its own Stripe account is its own business: texts and emails carry its name.
  const ownEntity = !!location?.stripeAccountId;
  const ctx: ApptContext = {
    businessName: ownEntity ? location!.name : business.name,
    logoUrl: business.logoUrl,
    brandColor: business.brandColor,
    businessPhone: location?.phone ?? business.phone,
    address: location ? (addressOf(location) ?? business.addressLine) : business.addressLine,
    timeZone: tzFor(business, location),
    clientFirstName: client?.firstName ?? "there",
    services: [...new Set(use.map((i) => i.name.replace(" (finish)", "")))].join(", "),
    staffName: [...new Set(use.map((i) => i.staffName))].join(" & "),
    startAt: use[0]!.startAt,
    manageUrl: siteUrl(business, `/manage/${appt.manageToken}`),
    policy: business.bookingPolicy,
    cancelWindowHours: business.cancelWindowHours,
    lateCancelFee: (() => {
      const policy = { feeType: business.lateCancelFeeType as "none" | "flat" | "percent", feeValue: business.lateCancelFeeValue, deposit: business.lateCancelDeposit as "toward" | "extra" };
      // Skip the added sentence when the owner's own policy text already states this fee.
      return policyFeeCheck(business.bookingPolicy, policy).repeats.length ? null : lateCancelFeeLabel(policy, (c) => formatMoney(c, business.currency));
    })(),
    depositPaid: appt.depositStatus === "paid" || appt.depositStatus === "applied" ? formatMoney(appt.depositCents, business.currency) : null,
    cardOnFile: !!appt.cardSetupIntentId,
    formsUrl: (await formsForAppointment(tx, appt.id)).some((f) => !f.current) ? siteUrl(business, `/manage/${appt.manageToken}/forms`) : null,
    prepNotes,
    clientPhotos: (await clientPhotoCounts(tx, [appt.id])).get(appt.id) ?? 0,
  };
  return { appt, client, ctx };
}

/** "Before your visit" lines for these services: the service's own note, else the nearest category note; deduplicated. */
export async function prepNotesFor(tx: TenantDb, serviceIds: string[]): Promise<string[]> {
  if (!serviceIds.length) return [];
  const services = await tx.select({ id: schema.services.id, prepNotes: schema.services.prepNotes, categoryId: schema.services.categoryId }).from(schema.services).where(inArray(schema.services.id, [...new Set(serviceIds)]));
  const cats = services.some((s) => !s.prepNotes?.trim() && s.categoryId) ? await tx.select({ id: schema.serviceCategories.id, parentId: schema.serviceCategories.parentId, prepNotes: schema.serviceCategories.prepNotes }).from(schema.serviceCategories) : [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out: string[] = [];
  for (const s of services) {
    let note = s.prepNotes?.trim() ?? "";
    let cur = note ? undefined : (s.categoryId ? byId.get(s.categoryId) : undefined);
    const seen = new Set<string>();
    while (!note && cur && !seen.has(cur.id)) { seen.add(cur.id); note = cur.prepNotes?.trim() ?? ""; cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    if (note && !out.includes(note)) out.push(note);
  }
  return out;
}

/**
 * Queue confirmation/update/cancellation messages for an appointment on every
 * channel the client has opted into. Sends right after the response is flushed.
 */
export async function notifyAppointment(business: typeof schema.businesses.$inferSelect, appointmentId: string, template: TemplateName) {
  const ids = await withTenant(business.id, async (tx) => {
    const built = await appointmentContext(tx, business, appointmentId);
    if (!built || !built.client) return [];
    const { appt, client, ctx } = built;
    const t = templates[template](ctx);
    const rows: (typeof schema.notifications.$inferInsert)[] = [];
    const phone = normalizePhone(client.phone);
    if (client.emailOptIn && client.email) {
      const mail = await designedEmail(tx, template === "formsNudge" ? "forms_nudge" : template, t, ctx, apptVars(business, ctx, { last_name: client.lastName }));
      rows.push({ businessId: business.id, clientId: client.id, appointmentId: appt.id, locationId: appt.locationId, channel: "email", template, recipient: client.email, subject: mail.subject, body: mail.html });
    }
    if (client.smsOptIn && phone) {
      rows.push({ businessId: business.id, clientId: client.id, appointmentId: appt.id, locationId: appt.locationId, channel: "sms", template, recipient: phone, body: await smsWithStopNotice(tx, client, smsBody(business, template === "formsNudge" ? "forms_nudge" : template, ctx)) });
    }
    if (template === "cancellation") {
      // Drop any pending reminder / pre-visit message for this appointment.
      await tx
        .update(schema.notifications)
        .set({ status: "cancelled" })
        .where(and(eq(schema.notifications.appointmentId, appt.id), eq(schema.notifications.status, "queued"), inArray(schema.notifications.template, ["reminder", "auto_pre_visit"])));
    }
    if (template === "rescheduled") {
      // Reminders queued by the pre-workflow scheduler for the old time (or still queued at all) are dropped;
      // the "Appointment reminder" workflow restarts for the new time (see resyncAppointmentRuns).
      await tx
        .update(schema.notifications)
        .set({ status: "cancelled" })
        .where(and(eq(schema.notifications.appointmentId, appt.id), eq(schema.notifications.status, "queued"), inArray(schema.notifications.template, ["reminder", "auto_pre_visit"]), isNull(schema.notifications.workflowRunId)));
    }
    if (!rows.length) return [];
    const inserted = await tx.insert(schema.notifications).values(rows).returning({ id: schema.notifications.id });
    return inserted.map((r) => r.id);
  });
  if (ids.length) after(() => deliverMany(business.id, ids));
  // Workflows (Automations) react to the same events. The engine reports and swallows its own errors, so a workflow problem never
  // turns into an error for a booking that exists.
  if (template === "confirmation") await afterAppointmentBooked(business, appointmentId);
  else if (template === "cancellation" || template === "rescheduled") await appointmentChangedSilently(business, appointmentId, template === "cancellation" ? "cancelled" : "rescheduled");
}

/**
 * An appointment was made without a confirmation (later visits in a series, the desk's "no confirmation", API notify:false, an
 * import): its "Appointment booked" workflows still start (the reminder ones only when `reminders`), and the client's "stop if they
 * book again" runs stop. Imported lazily: the workflows module uses this one for contexts and delivery.
 */
export async function afterAppointmentBooked(business: typeof schema.businesses.$inferSelect, appointmentId: string, opts: { reminders?: boolean } = {}) {
  const wf = await import("@/server/workflows");
  await wf.afterAppointmentBooked(business, appointmentId, opts);
}

/**
 * An appointment moved or was cancelled without a message to the client (API notify:false): runs timed from it are re-timed or
 * dropped, and "Appointment cancelled" workflows start, exactly as when the client is told.
 */
export async function appointmentChangedSilently(business: typeof schema.businesses.$inferSelect, appointmentId: string, change: "rescheduled" | "cancelled") {
  const wf = await import("@/server/workflows");
  await wf.resyncAppointmentRuns(business, appointmentId, change);
  if (change === "cancelled") await wf.triggerAppointmentWorkflows(business, "appointment_cancelled", appointmentId);
}

/** Templates that are only meaningful while the visit is still on. */
const VISIT_BOUND_TEMPLATES = ["reminder", "auto_pre_visit", "formsNudge"];

/** Drop queued reminders / pre-visit / forms messages for an appointment that is no longer happening. */
export async function cancelQueuedReminders(businessId: string, appointmentId: string) {
  await withTenant(businessId, (tx) =>
    tx
      .update(schema.notifications)
      .set({ status: "cancelled" })
      .where(and(eq(schema.notifications.appointmentId, appointmentId), eq(schema.notifications.status, "queued"), inArray(schema.notifications.template, VISIT_BOUND_TEMPLATES))),
  );
}

/**
 * Safety net run before every claim: any queued visit-bound message whose
 * appointment has since been cancelled (by whatever path) is dropped, so a
 * client never gets a reminder for a visit that is not happening.
 */
async function sweepOrphanedReminders(tx: TenantDb) {
  const gone = tx.select({ id: schema.appointments.id }).from(schema.appointments).where(inArray(schema.appointments.status, ["cancelled", "no_show"]));
  await tx
    .update(schema.notifications)
    .set({ status: "cancelled", error: "Appointment cancelled" })
    .where(and(eq(schema.notifications.status, "queued"), inArray(schema.notifications.template, VISIT_BOUND_TEMPLATES), inArray(schema.notifications.appointmentId, gone)));
}

/** Queue a one-off message (e.g. staff invitation) and send it after the response. */
export async function queueOneOff(businessId: string, input: { channel: "email" | "sms"; template: string; recipient: string; subject?: string; body: string; clientId?: string | null; appointmentId?: string | null; locationId?: string | null; /** Pictures on a text (MMS). */ media?: { url: string; type: string }[] }) {
  const [row] = await withTenant(businessId, (tx) =>
    tx.insert(schema.notifications).values({ businessId, ...input }).returning({ id: schema.notifications.id }),
  );
  if (row) after(() => deliverMany(businessId, [row.id]));
}

type Outcome = { id: string; status: "sent" | "failed" | "skipped"; providerId?: string; error?: string; /** The carrier says this number opted out: suppress it. */ suppress?: string; /** Throttled by the provider: try again soon without using up an attempt. */ throttled?: boolean; /** With throttled: how long to wait (default a minute). */ retryInMs?: number };

/** Rows left in "sending" longer than this are assumed orphaned (process died mid-run) and retried. */
const STALE_CLAIM_MS = 10 * 60_000;
/** Parallel provider calls per delivery run. Resend and Twilio both tolerate this comfortably. */
const CONCURRENCY = 8;
/** A send that errors is retried this many times in total, 5 min then 10 min then 20 min apart. */
const MAX_ATTEMPTS = 3;
/** How long a text waits for texting to be switched back on (billing) before it is given up as stale. */
const SMS_PAUSE_HOLD_MS = 48 * 3_600_000;
const retryDelayMs = (attempt: number) => 5 * 60_000 * 2 ** Math.max(0, attempt - 1);

/**
 * Atomically claim due rows for one business: queued rows that are due, plus
 * stale "sending" rows. The UPDATE is the lock, so two concurrent runs (cron +
 * after-response delivery, or overlapping deploys) can never both send a row.
 */
type Claimed = { row: Row; sender: SmsSender | null; /** Why consent forbids sending this now (checked at send time, not only when queued). */ consentBlock?: string | null; /** One-click unsubscribe address for a marketing email. */ unsubscribe?: string | null; email: { fromName: string; replyTo?: string; demo: boolean; suspended: boolean; smsPausedReason: string | null; blocked: string | null; emailBudget: { left: number } | null } | null };

/**
 * The sender a message texts from: the verified number of the location it is
 * about (else the business's verified number), else the platform fallback
 * (TWILIO_FROM / TWILIO_MESSAGING_SERVICE_SID), else nothing.
 */
async function smsSenderFor(tx: TenantDb, locationId: string | null): Promise<SmsSender | null> {
  const numbers = await listNumbers(tx);
  const own = (locationId ? numbers.find((n) => n.locationId === locationId && n.status === "verified") : undefined) ?? numbers.find((n) => !n.locationId && n.status === "verified");
  if (own) return { from: own.phoneNumber };
  return platformSmsSender();
}

async function claimWithSender(tx: TenantDb, opts: { ids?: string[]; limit: number }): Promise<Claimed[]> {
  await sweepOrphanedReminders(tx);
  const rows = await claim(tx, opts);
  if (!rows.length) return [];
  const senders = new Map<string | null, SmsSender | null>();
  for (const r of rows) {
    if (r.channel !== "sms" || senders.has(r.locationId)) continue;
    senders.set(r.locationId, await smsSenderFor(tx, r.locationId));
  }
  // Emails go out as "<Business> <platform address>" with replies routed to the business.
  const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, rows[0]!.businessId), columns: { name: true, email: true, slug: true, suspendedAt: true, comped: true, subscriptionStatus: true } });
  // Texts cost money and are billed on the subscription: no active subscription, no texts (see smsPausedReason).
  const smsPausedWhy = biz && rows.some((r) => r.channel === "sms")
    ? smsPausedReason({ billingEnabled: billingEnabled(), comped: biz.comped, status: biz.subscriptionStatus, smsUsageCents: (await priceBookIn(tx, rows[0]!.businessId)).smsUsageCents })
    : null;
  // Nothing at all goes out while the trial is over with no subscription, or before a new owner has verified their email; and
  // until there is a subscription, emails are capped per day (the cap is in the price book).
  let blocked: string | null = null;
  let emailBudget: { left: number } | null = null;
  if (biz && !biz.suspendedAt) {
    const full = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, rows[0]!.businessId) });
    if (full) {
      if ((await businessAccess(full)).state === "expired") blocked = "Free trial ended: add a card under Settings → Billing to resume messages.";
      else blocked = await publishBlockedReason(full);
      const cap = emailDailyCap({ comped: full.comped, status: full.subscriptionStatus, cap: (await priceBookIn(tx, full.id)).trialEmailCap });
      if (cap !== null && rows.some((r) => r.channel === "email")) {
        const [sent] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.notifications)
          .where(and(eq(schema.notifications.channel, "email"), eq(schema.notifications.status, "sent"), gte(schema.notifications.sentAt, new Date(Date.now() - 86_400_000))));
        emailBudget = { left: Math.max(0, cap - Number(sent?.n ?? 0)) };
      }
    }
  }
  const email = biz ? { fromName: biz.name, replyTo: biz.email ?? undefined, demo: isDemoSlug(biz.slug), suspended: !!biz.suspendedAt, smsPausedReason: smsPausedWhy, blocked, emailBudget } : null;
  const block = await consentBlocks(tx, rows);
  return rows.map((row) => ({
    row,
    sender: row.channel === "sms" ? (senders.get(row.locationId) ?? null) : null,
    email,
    consentBlock: block(row),
    unsubscribe: row.marketing && row.channel === "email" && row.clientId && biz ? oneClickUnsubscribeUrl({ id: row.businessId, slug: biz.slug }, row.clientId) : null,
  }));
}

/**
 * Consent as it stands right before sending (a STOP, an unsubscribe or an edit may have come after the message was queued):
 *   - no text ever goes to a number on the suppression list;
 *   - a text to a client's own number needs their text consent, and a marketing text their marketing consent;
 *   - a marketing email needs the client's email consent and that they haven't unsubscribed.
 * Appointment emails were checked when queued and go to whatever address they were queued for (a gift card's recipient, for one).
 */
async function consentBlocks(tx: TenantDb, rows: Row[]): Promise<(row: Row) => string | null> {
  const ids = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => !!x))];
  const people = ids.length
    ? await tx.select({ id: schema.clients.id, phone: schema.clients.phone, smsOptIn: schema.clients.smsOptIn, emailOptIn: schema.clients.emailOptIn, smsMarketingOptIn: schema.clients.smsMarketingOptIn, emailMarketingOptIn: schema.clients.emailMarketingOptIn }).from(schema.clients).where(inArray(schema.clients.id, ids))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const suppressed = await suppressedTails(tx, rows.filter((r) => r.channel === "sms").map((r) => r.recipient));
  return (r) => {
    const c = r.clientId ? byId.get(r.clientId) : undefined;
    if (r.channel === "sms") {
      if (suppressed.has(phoneTail(r.recipient))) return "This number replied STOP: no texts are sent to it";
      if (c && phoneTail(c.phone) === phoneTail(r.recipient) && !c.smsOptIn) return "The client has turned texts off";
      if (r.marketing && (!c || !c.smsMarketingOptIn)) return "No consent to marketing texts";
      return null;
    }
    if (r.marketing && (!c || !c.emailOptIn || !c.emailMarketingOptIn)) return "The client unsubscribed from marketing emails";
    return null;
  };
}

async function claim(tx: TenantDb, opts: { ids?: string[]; limit: number }): Promise<Row[]> {
  const stale = new Date(Date.now() - STALE_CLAIM_MS);
  const due = or(
    and(eq(schema.notifications.status, "queued"), lte(schema.notifications.scheduledAt, new Date())),
    and(eq(schema.notifications.status, "sending"), lte(schema.notifications.claimedAt, stale)),
  );
  const where = opts.ids ? and(due, inArray(schema.notifications.id, opts.ids)) : due;
  // Lock the batch first, then update exactly those rows. As a subquery of the UPDATE, Postgres may re-run the LIMIT … SKIP LOCKED
  // scan per row, skipping what it just claimed each time, and so claim far more than `limit` (a whole campaign).
  const candidates = await tx
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(where)
    // Appointment messages before marketing, so a big campaign never holds up today's reminders.
    .orderBy(asc(schema.notifications.marketing), asc(schema.notifications.scheduledAt))
    .limit(opts.limit)
    .for("update", { skipLocked: true });
  if (!candidates.length) return [];
  const rows = await tx
    .update(schema.notifications)
    .set({ status: "sending", claimedAt: new Date() })
    .where(inArray(schema.notifications.id, candidates.map((c) => c.id)))
    .returning();
  const rank = new Map(candidates.map((c, i) => [c.id, i]));
  return rows.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
}

async function send({ row: n, sender, email, consentBlock, unsubscribe }: Claimed): Promise<Outcome> {
  if (consentBlock) return { id: n.id, status: "skipped", error: consentBlock };
  // Demo businesses have fake clients: log the message but never email or text anyone.
  if (email?.demo) return { id: n.id, status: "skipped", error: "Demo business: nothing is sent" };
  if (email?.suspended) return { id: n.id, status: "skipped", error: "Business is suspended: nothing is sent" };
  if (email?.blocked) return { id: n.id, status: "skipped", error: email.blocked };
  if (n.channel === "email" && email?.emailBudget) {
    if (email.emailBudget.left <= 0) return { id: n.id, status: "skipped", error: "Daily email limit for accounts without a subscription: add a card under Settings → Billing." };
    email.emailBudget.left--;
  }
  // Texting paused for billing: hold the text (it goes once texting is back) unless it has waited two days and is stale by now.
  if (n.channel === "sms" && email?.smsPausedReason) {
    return n.createdAt.getTime() > Date.now() - SMS_PAUSE_HOLD_MS ? { id: n.id, status: "failed", error: email.smsPausedReason, throttled: true, retryInMs: 30 * 60_000 } : { id: n.id, status: "skipped", error: email.smsPausedReason };
  }
  const configured = n.channel === "email" ? emailConfigured() : smsConfigured();
  if (!configured) return { id: n.id, status: "skipped", error: `${n.channel} provider not configured` };
  if (n.channel === "sms" && !sender) return { id: n.id, status: "skipped", error: "No verified text number yet (Settings → Text messaging)" };
  try {
    const headers = unsubscribe ? { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined;
    const r = n.channel === "email" ? await sendEmailPaced({ to: n.recipient, subject: n.subject ?? "", html: n.body, fromName: email?.fromName, replyTo: email?.replyTo, headers }) : await sendSms({ to: n.recipient, body: n.body, sender: sender!, media: n.media ?? [] });
    return { id: n.id, status: "sent", providerId: r.id };
  } catch (e) {
    if (e instanceof EmailRateLimitError) return { id: n.id, status: "failed", error: "Email provider busy", throttled: true };
    // Twilio 21610: the person has opted out of this number. Not worth retrying; nothing more should go to them.
    if (e instanceof TwilioError && e.code === 21610) return { id: n.id, status: "skipped", error: "This person replied STOP to your number", suppress: n.recipient };
    return { id: n.id, status: "failed", error: (e as Error).message };
  }
}

/** Send one email inside the Resend rate limit; when Resend still says "too many", wait as asked and try twice more. */
async function sendEmailPaced(input: Parameters<typeof sendEmail>[0]) {
  for (let tries = 0; ; tries++) {
    await emailTurn();
    try {
      return await sendEmail(input);
    } catch (e) {
      if (!(e instanceof EmailRateLimitError) || tries >= 2) throw e;
      await new Promise((r) => setTimeout(r, Math.min(e.retryAfterMs, 5000)));
    }
  }
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pooled<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Send claimed rows (outside any transaction) and record the outcomes per business. */
async function deliverClaimed(claimed: Claimed[]): Promise<Summary> {
  const summary: Summary = { processed: claimed.length, sent: 0, failed: 0, skipped: 0 };
  if (!claimed.length) return summary;
  const outcomes = await pooled(claimed, CONCURRENCY, send);
  const byBusiness = new Map<string, Outcome[]>();
  claimed.forEach((c, i) => {
    const o = outcomes[i]!;
    summary[o.status]++;
    byBusiness.set(c.row.businessId, [...(byBusiness.get(c.row.businessId) ?? []), o]);
  });
  const smsById = new Map(claimed.filter((c) => c.row.channel === "sms").map((c) => [c.row.id, true]));
  const rowById = new Map(claimed.map((c) => [c.row.id, c.row]));
  for (const [businessId, list] of byBusiness) {
    await withTenant(businessId, async (tx) => {
      for (const o of list) {
        const attempts = (rowById.get(o.id)?.attempts ?? 0) + 1;
        const patch =
          o.status === "sent"
            ? { status: "sent" as const, sentAt: new Date(), providerId: o.providerId, error: null, attempts }
            : o.throttled
              ? // The provider was only busy: back in the queue for the next run, and it doesn't count as a try.
                { status: "queued" as const, error: `${o.error} (retrying)`, claimedAt: null, scheduledAt: new Date(Date.now() + (o.retryInMs ?? 60_000)) }
              : o.status === "failed" && attempts < MAX_ATTEMPTS
              ? // A provider error (outage, rate limit) gets another go later; the error is kept visible meanwhile.
                { status: "queued" as const, error: `${o.error} (retrying)`, attempts, claimedAt: null, scheduledAt: new Date(Date.now() + retryDelayMs(attempts)) }
              : { status: o.status, error: o.error, attempts };
        await tx
          .update(schema.notifications)
          .set(patch)
          .where(and(eq(schema.notifications.id, o.id), eq(schema.notifications.status, "sending")));
        // A message a workflow queued: the run's log says what became of it (the run read "queued" until now).
        const row = rowById.get(o.id);
        if (row?.workflowRunId && patch.status !== "queued") await noteRunOutcome(tx, row, patch.status, o.error);
      }
    });
    for (const o of list) if (o.suppress) await withTenant(businessId, (tx) => suppressSms(tx, businessId, o.suppress!, "carrier"));
    // Metered billing: one meter event per text actually sent (idempotent on the notification id).
    await reportSmsUsage(businessId, list.filter((o) => o.status === "sent" && smsById.has(o.id)).map((o) => o.id));
  }
  return summary;
}

export type Summary = { processed: number; sent: number; failed: number; skipped: number };

/** Append "Text sent to …" / "Email skipped: no consent …" to the workflow run that queued a message. Appended in SQL so the cron, which may hold the run, can't overwrite it. */
async function noteRunOutcome(tx: TenantDb, row: Row, status: "sent" | "skipped" | "failed", error?: string) {
  const what = row.channel === "sms" ? "Text" : "Email";
  const detail = status === "sent" ? `${what} sent to ${row.recipient}` : `${what} ${status === "failed" ? "failed" : "skipped"}: ${error ?? "unknown reason"}`;
  const entry = { at: new Date().toISOString(), step: null, event: status, detail };
  await tx.update(schema.workflowRuns).set({ log: sql`${schema.workflowRuns.log} || ${JSON.stringify([entry])}::jsonb` }).where(eq(schema.workflowRuns.id, row.workflowRunId!));
}

/** Put a failed or skipped message back in the queue and try it right away (Settings → Messages → Send again). */
export async function resendNotification(businessId: string, id: string): Promise<Summary> {
  const rows = await withTenant(businessId, (tx) =>
    tx
      .update(schema.notifications)
      .set({ status: "queued", attempts: 0, error: null, claimedAt: null, scheduledAt: new Date() })
      .where(and(eq(schema.notifications.id, id), inArray(schema.notifications.status, ["failed", "skipped"])))
      .returning({ id: schema.notifications.id }),
  );
  if (!rows.length) return { processed: 0, sent: 0, failed: 0, skipped: 0 };
  return deliverMany(businessId, [id]);
}

/** Deliver specific rows now (used right after a response). Rows not yet due are left queued. */
export async function deliverMany(businessId: string, ids: string[]): Promise<Summary> {
  const total: Summary = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  // In small batches, each claimed just before it is sent: claiming a whole campaign at once let the cron reclaim (and send again) rows
  // still waiting their turn after STALE_CLAIM_MS.
  for (let i = 0; i < ids.length; i += CLAIM_BATCH) {
    const claimed = await withTenant(businessId, (tx) => claimWithSender(tx, { ids: ids.slice(i, i + CLAIM_BATCH), limit: CLAIM_BATCH }));
    const r = await deliverClaimed(claimed);
    for (const k of Object.keys(total) as (keyof Summary)[]) total[k] += r[k];
  }
  return total;
}

const CLAIM_BATCH = 50;

/**
 * Cron entry point: deliver everything due across all tenants.
 * Finding the work needs a cross-tenant read, which RLS only allows inside
 * `withJobs`; claiming and writing back stay tenant-scoped.
 */
export async function deliverDue(opts: { perBusiness?: number; perRound?: number; budgetMs?: number; /** Only these businesses (tests). */ businessIds?: string[] } = {}): Promise<Summary> {
  const perBusiness = opts.perBusiness ?? 200;
  const perRound = opts.perRound ?? 10;
  // Stop claiming well before the next run (every 5 minutes) and before a claim goes stale; what's left waits for that run.
  const deadline = Date.now() + (opts.budgetMs ?? 3 * 60_000);
  const stale = new Date(Date.now() - STALE_CLAIM_MS);
  const due = await withJobs((tx) =>
    tx
      .selectDistinct({ businessId: schema.notifications.businessId })
      .from(schema.notifications)
      .where(
        and(
          or(
            and(eq(schema.notifications.status, "queued"), lte(schema.notifications.scheduledAt, new Date())),
            and(eq(schema.notifications.status, "sending"), lte(schema.notifications.claimedAt, stale)),
          ),
          opts.businessIds ? inArray(schema.notifications.businessId, opts.businessIds) : undefined,
        ),
      )
      .limit(500),
  );
  // Round robin: a few messages from each business per round, so one business's campaign can't starve everyone else's reminders.
  const total: Summary = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  const taken = new Map<string, number>();
  let active = due.map((d) => d.businessId);
  while (active.length && Date.now() < deadline) {
    const round: Claimed[][] = [];
    for (const businessId of active) {
      const n = Math.min(perRound, perBusiness - (taken.get(businessId) ?? 0));
      round.push(n > 0 ? await withTenant(businessId, (tx) => claimWithSender(tx, { limit: n })) : []);
    }
    const r = await deliverClaimed(interleave(round));
    for (const k of Object.keys(total) as (keyof Summary)[]) total[k] += r[k];
    active = active.filter((id, i) => {
      taken.set(id, (taken.get(id) ?? 0) + round[i]!.length);
      return round[i]!.length === perRound && taken.get(id)! < perBusiness;
    });
  }
  return total;
}

/** [[a1, a2], [b1]] → [a1, b1, a2]: sends alternate between businesses. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}
