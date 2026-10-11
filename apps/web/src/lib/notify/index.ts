import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import { after } from "next/server";
import { db, schema, withJobs, withTenant, type TenantDb } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
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
import { marketingEmail } from "./templates";
import { appointmentVars, renderText, unsubscribeUrl } from "@/server/marketing";

type Row = typeof schema.notifications.$inferSelect;

/** Build the template context for an appointment (must run inside the tenant tx). */
export async function appointmentContext(tx: TenantDb, business: typeof schema.businesses.$inferSelect, appointmentId: string) {
  const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId) });
  if (!appt) return null;
  const items = await tx
    .select({ name: schema.appointmentItems.serviceName, startAt: schema.appointmentItems.startAt, staffName: schema.staff.displayName, status: schema.appointmentItems.status })
    .from(schema.appointmentItems)
    .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
    .where(eq(schema.appointmentItems.appointmentId, appointmentId))
    .orderBy(asc(schema.appointmentItems.startAt));
  const live = items.filter((i) => i.status !== "cancelled");
  const use = live.length ? live : items;
  if (!use.length) return null;
  const client = appt.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, appt.clientId) }) : null;
  // Messages speak for the location of the visit: its phone, address and clock.
  const location = appt.locationId ? await tx.query.locations.findFirst({ where: eq(schema.locations.id, appt.locationId) }) : null;
  const ctx: ApptContext = {
    businessName: business.name,
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
    depositPaid: appt.depositStatus === "paid" || appt.depositStatus === "applied" ? formatMoney(appt.depositCents, business.currency) : null,
    cardOnFile: !!appt.cardSetupIntentId,
    formsUrl: (await formsForAppointment(tx, appt.id)).some((f) => !f.current) ? appUrl(`/book/${business.slug}/manage/${appt.manageToken}/forms`) : null,
  };
  return { appt, client, ctx };
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
      rows.push({ businessId: business.id, clientId: client.id, appointmentId: appt.id, locationId: appt.locationId, channel: "sms", template, recipient: phone, body: await smsWithStopNotice(tx, client, smsBody(business, template, ctx)) });
    }
    if (template === "cancellation") {
      // Drop any pending reminder / pre-visit message for this appointment.
      await tx
        .update(schema.notifications)
        .set({ status: "cancelled" })
        .where(and(eq(schema.notifications.appointmentId, appt.id), eq(schema.notifications.status, "queued"), inArray(schema.notifications.template, ["reminder", "auto_pre_visit"])));
    }
    if (template === "confirmation" || template === "rescheduled") {
      await scheduleReminder(tx, business, appt.id, client, ctx, phone, appt.locationId);
    }
    if (!rows.length) return [];
    const inserted = await tx.insert(schema.notifications).values(rows).returning({ id: schema.notifications.id });
    return inserted.map((r) => r.id);
  });
  if (ids.length) after(() => deliverMany(business.id, ids));
}

/** Schedule the reminder for an appointment without sending a confirmation (used for later visits in a series). */
export async function scheduleReminderFor(business: typeof schema.businesses.$inferSelect, appointmentId: string) {
  await withTenant(business.id, async (tx) => {
    const built = await appointmentContext(tx, business, appointmentId);
    if (!built || !built.client) return;
    await scheduleReminder(tx, business, appointmentId, built.client, built.ctx, normalizePhone(built.client.phone), built.appt.locationId);
  });
}

async function scheduleReminder(
  tx: TenantDb,
  business: typeof schema.businesses.$inferSelect,
  appointmentId: string,
  client: typeof schema.clients.$inferSelect,
  ctx: ApptContext,
  phone: string | null,
  locationId: string | null = null,
) {
  // Replace any existing reminder / pre-visit message (time may have changed).
  await tx
    .update(schema.notifications)
    .set({ status: "cancelled" })
    .where(and(eq(schema.notifications.appointmentId, appointmentId), eq(schema.notifications.status, "queued"), inArray(schema.notifications.template, ["reminder", "auto_pre_visit"])));
  const rows: (typeof schema.notifications.$inferInsert)[] = [];
  const at = new Date(ctx.startAt.getTime() - business.reminderHours * 3_600_000);
  if (at > new Date()) {
    const t = templates.reminder(ctx);
    if (client.emailOptIn && client.email) rows.push({ businessId: business.id, clientId: client.id, appointmentId, locationId, channel: "email", template: "reminder", recipient: client.email, subject: t.subject, body: t.html, scheduledAt: at });
    if (client.smsOptIn && phone) rows.push({ businessId: business.id, clientId: client.id, appointmentId, locationId, channel: "sms", template: "reminder", recipient: phone, body: await smsWithStopNotice(tx, client, smsBody(business, "reminder", ctx)), scheduledAt: at });
  }
  // Optional pre-visit message (Marketing → Automations), e.g. prep instructions 48h before.
  const pre = await tx.query.automations.findFirst({ where: and(eq(schema.automations.kind, "pre_visit"), eq(schema.automations.enabled, true)) });
  if (pre) {
    const preAt = new Date(ctx.startAt.getTime() - pre.hoursBefore * 3_600_000);
    if (preAt > new Date()) {
      const vars = appointmentVars(business, ctx);
      const brand = { businessName: business.name, logoUrl: business.logoUrl, brandColor: business.brandColor, businessPhone: business.phone, address: business.addressLine };
      const wantEmail = pre.channel === "email" || pre.channel === "both";
      const wantSms = pre.channel === "sms" || pre.channel === "both";
      if (wantEmail && client.emailOptIn && client.email) {
        const t = marketingEmail(brand, { subject: renderText(pre.subject ?? "Getting ready for your visit", vars), text: renderText(pre.body, vars), ctaLabel: "Manage appointment", ctaUrl: ctx.manageUrl, unsubscribeUrl: unsubscribeUrl(business, client.id) });
        rows.push({ businessId: business.id, clientId: client.id, appointmentId, locationId, channel: "email", template: "auto_pre_visit", recipient: client.email, subject: t.subject, body: t.html, scheduledAt: preAt });
      }
      if (wantSms && client.smsOptIn && phone) rows.push({ businessId: business.id, clientId: client.id, appointmentId, locationId, channel: "sms", template: "auto_pre_visit", recipient: phone, body: await smsWithStopNotice(tx, client, `${business.name}: ${renderText(pre.body, vars)}`), scheduledAt: preAt });
    }
  }
  if (rows.length) await tx.insert(schema.notifications).values(rows);
}

/** Queue a one-off message (e.g. staff invitation) and send it after the response. */
export async function queueOneOff(businessId: string, input: { channel: "email" | "sms"; template: string; recipient: string; subject?: string; body: string; clientId?: string | null }) {
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
  for (const [businessId, list] of byBusiness) {
    await withTenant(businessId, async (tx) => {
      for (const o of list) {
        await tx
          .update(schema.notifications)
          .set(o.status === "sent" ? { status: "sent", sentAt: new Date(), providerId: o.providerId, error: null } : { status: o.status, error: o.error })
          .where(and(eq(schema.notifications.id, o.id), eq(schema.notifications.status, "sending")));
      }
    });
    // Metered billing: one meter event per text actually sent (idempotent on the notification id).
    await reportSmsUsage(businessId, list.filter((o) => o.status === "sent" && smsById.has(o.id)).map((o) => o.id));
  }
  return summary;
}

export type Summary = { processed: number; sent: number; failed: number; skipped: number };

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
