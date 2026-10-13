import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { after } from "next/server";
import { db, schema, withJobs, withTenant, type TenantDb } from "@angelic/db";
import { normalizePhone, lateCancelFeeLabel, policyFeeCheck } from "@angelic/core";
import { appUrl } from "@/lib/stripe";
import { formatMoney } from "@/lib/utils";
import { formsForAppointment } from "@/server/forms";
import { emailConfigured, sendEmail, sendSms, smsConfigured, type SmsSender } from "./providers";
import { platformSmsSender } from "@/lib/twilio";
import { listNumbers } from "@/server/messaging";
import { addressOf, tzFor } from "@/server/locations";
import { reportSmsUsage } from "@/server/billing";
import { templates, type ApptContext, type TemplateName } from "./templates";
import { smsBody, smsWithStopNotice } from "./sms";

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
    manageUrl: appUrl(`/book/${business.slug}/manage/${appt.manageToken}`),
    policy: business.bookingPolicy,
    cancelWindowHours: business.cancelWindowHours,
    lateCancelFee: (() => {
      const policy = { feeType: business.lateCancelFeeType as "none" | "flat" | "percent", feeValue: business.lateCancelFeeValue, deposit: business.lateCancelDeposit as "toward" | "extra" };
      // Skip the added sentence when the owner's own policy text already states this fee.
      return policyFeeCheck(business.bookingPolicy, policy).repeats.length ? null : lateCancelFeeLabel(policy, (c) => formatMoney(c, business.currency));
    })(),
    depositPaid: appt.depositStatus === "paid" || appt.depositStatus === "applied" ? formatMoney(appt.depositCents, business.currency) : null,
    cardOnFile: !!appt.cardSetupIntentId,
    formsUrl: (await formsForAppointment(tx, appt.id)).some((f) => !f.current) ? appUrl(`/book/${business.slug}/manage/${appt.manageToken}/forms`) : null,
    prepNotes,
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
      rows.push({ businessId: business.id, clientId: client.id, appointmentId: appt.id, locationId: appt.locationId, channel: "email", template, recipient: client.email, subject: t.subject, body: t.html });
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
  // Workflows (Automations) react to the same events. Imported lazily: that module
  // uses this one for contexts and delivery.
  const wf = await import("@/server/workflows");
  if (template === "confirmation") {
    await wf.triggerAppointmentWorkflows(business, "appointment_booked", appointmentId);
    const appt = await withTenant(business.id, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId), columns: { clientId: true } }));
    if (appt?.clientId) await wf.noteClientBooked(business, appt.clientId);
  } else if (template === "cancellation") {
    await wf.resyncAppointmentRuns(business, appointmentId, "cancelled");
    await wf.triggerAppointmentWorkflows(business, "appointment_cancelled", appointmentId);
  } else if (template === "rescheduled") {
    await wf.resyncAppointmentRuns(business, appointmentId, "rescheduled");
  }
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

/** Later visits in a series get no confirmation, but their "Appointment booked" workflows (reminder …) start. */
export async function scheduleReminderFor(business: typeof schema.businesses.$inferSelect, appointmentId: string) {
  const wf = await import("@/server/workflows");
  await wf.triggerAppointmentWorkflows(business, "appointment_booked", appointmentId);
}

/** Queue a one-off message (e.g. staff invitation) and send it after the response. */
export async function queueOneOff(businessId: string, input: { channel: "email" | "sms"; template: string; recipient: string; subject?: string; body: string; clientId?: string | null; appointmentId?: string | null; locationId?: string | null }) {
  const [row] = await withTenant(businessId, (tx) =>
    tx.insert(schema.notifications).values({ businessId, ...input }).returning({ id: schema.notifications.id }),
  );
  if (row) after(() => deliverMany(businessId, [row.id]));
}

type Outcome = { id: string; status: "sent" | "failed" | "skipped"; providerId?: string; error?: string };

/** Rows left in "sending" longer than this are assumed orphaned (process died mid-run) and retried. */
const STALE_CLAIM_MS = 10 * 60_000;
/** Parallel provider calls per delivery run. Resend and Twilio both tolerate this comfortably. */
const CONCURRENCY = 8;
/** A send that errors is retried this many times in total, 5 min then 10 min then 20 min apart. */
const MAX_ATTEMPTS = 3;
const retryDelayMs = (attempt: number) => 5 * 60_000 * 2 ** Math.max(0, attempt - 1);

/**
 * Atomically claim due rows for one business: queued rows that are due, plus
 * stale "sending" rows. The UPDATE is the lock, so two concurrent runs (cron +
 * after-response delivery, or overlapping deploys) can never both send a row.
 */
type Claimed = { row: Row; sender: SmsSender | null; email: { fromName: string; replyTo?: string } | null };

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
  const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, rows[0]!.businessId), columns: { name: true, email: true } });
  const email = biz ? { fromName: biz.name, replyTo: biz.email ?? undefined } : null;
  return rows.map((row) => ({ row, sender: row.channel === "sms" ? (senders.get(row.locationId) ?? null) : null, email }));
}

async function claim(tx: TenantDb, opts: { ids?: string[]; limit: number }): Promise<Row[]> {
  const stale = new Date(Date.now() - STALE_CLAIM_MS);
  const due = or(
    and(eq(schema.notifications.status, "queued"), lte(schema.notifications.scheduledAt, new Date())),
    and(eq(schema.notifications.status, "sending"), lte(schema.notifications.claimedAt, stale)),
  );
  const where = opts.ids ? and(due, inArray(schema.notifications.id, opts.ids)) : due;
  const candidates = tx
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(where)
    .orderBy(asc(schema.notifications.scheduledAt))
    .limit(opts.limit)
    .for("update", { skipLocked: true });
  return tx
    .update(schema.notifications)
    .set({ status: "sending", claimedAt: new Date() })
    .where(inArray(schema.notifications.id, candidates))
    .returning();
}

async function send({ row: n, sender, email }: Claimed): Promise<Outcome> {
  const configured = n.channel === "email" ? emailConfigured() : smsConfigured();
  if (!configured) return { id: n.id, status: "skipped", error: `${n.channel} provider not configured` };
  if (n.channel === "sms" && !sender) return { id: n.id, status: "skipped", error: "No verified text number yet (Settings → Text messaging)" };
  try {
    const r = n.channel === "email" ? await sendEmail({ to: n.recipient, subject: n.subject ?? "", html: n.body, fromName: email?.fromName, replyTo: email?.replyTo }) : await sendSms({ to: n.recipient, body: n.body, sender: sender! });
    return { id: n.id, status: "sent", providerId: r.id };
  } catch (e) {
    return { id: n.id, status: "failed", error: (e as Error).message };
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
            : o.status === "failed" && attempts < MAX_ATTEMPTS
              ? // A provider error (outage, rate limit) gets another go later; the error is kept visible meanwhile.
                { status: "queued" as const, error: `${o.error} (retrying)`, attempts, claimedAt: null, scheduledAt: new Date(Date.now() + retryDelayMs(attempts)) }
              : { status: o.status, error: o.error, attempts };
        await tx
          .update(schema.notifications)
          .set(patch)
          .where(and(eq(schema.notifications.id, o.id), eq(schema.notifications.status, "sending")));
      }
    });
    // Metered billing: one meter event per text actually sent (idempotent on the notification id).
    await reportSmsUsage(businessId, list.filter((o) => o.status === "sent" && smsById.has(o.id)).map((o) => o.id));
  }
  return summary;
}

export type Summary = { processed: number; sent: number; failed: number; skipped: number };

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
  if (!ids.length) return { processed: 0, sent: 0, failed: 0, skipped: 0 };
  const claimed = await withTenant(businessId, (tx) => claimWithSender(tx, { ids, limit: ids.length }));
  return deliverClaimed(claimed);
}

/**
 * Cron entry point: deliver everything due across all tenants.
 * Finding the work needs a cross-tenant read, which RLS only allows inside
 * `withJobs`; claiming and writing back stay tenant-scoped.
 */
export async function deliverDue(limitPerBusiness = 200): Promise<Summary> {
  const stale = new Date(Date.now() - STALE_CLAIM_MS);
  const due = await withJobs((tx) =>
    tx
      .selectDistinct({ businessId: schema.notifications.businessId })
      .from(schema.notifications)
      .where(
        or(
          and(eq(schema.notifications.status, "queued"), lte(schema.notifications.scheduledAt, new Date())),
          and(eq(schema.notifications.status, "sending"), lte(schema.notifications.claimedAt, stale)),
        ),
      )
      .limit(500),
  );
  const claimed: Claimed[] = [];
  for (const { businessId } of due) {
    claimed.push(...(await withTenant(businessId, (tx) => claimWithSender(tx, { limit: limitPerBusiness }))));
  }
  return deliverClaimed(claimed);
}
