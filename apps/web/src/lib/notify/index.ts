import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import { after } from "next/server";
import { schema, withJobs, withTenant, type TenantDb } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { appUrl } from "@/lib/stripe";
import { emailConfigured, sendEmail, sendSms, smsConfigured } from "./providers";
import { templates, type ApptContext, type TemplateName } from "./templates";

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
  const ctx: ApptContext = {
    businessName: business.name,
    logoUrl: business.logoUrl,
    brandColor: business.brandColor,
    businessPhone: business.phone,
    address: business.addressLine,
    timeZone: business.timezone,
    clientFirstName: client?.firstName ?? "there",
    services: [...new Set(use.map((i) => i.name.replace(" (finish)", "")))].join(", "),
    staffName: [...new Set(use.map((i) => i.staffName))].join(" & "),
    startAt: use[0]!.startAt,
    manageUrl: appUrl(`/book/${business.slug}/manage/${appt.manageToken}`),
    policy: business.bookingPolicy,
    cancelWindowHours: business.cancelWindowHours,
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
      rows.push({ businessId: business.id, clientId: client.id, appointmentId: appt.id, channel: "email", template, recipient: client.email, subject: t.subject, body: t.html });
    }
    if (client.smsOptIn && phone) {
      rows.push({ businessId: business.id, clientId: client.id, appointmentId: appt.id, channel: "sms", template, recipient: phone, body: t.sms });
    }
    if (template === "cancellation") {
      // Drop any pending reminder for this appointment.
      await tx
        .update(schema.notifications)
        .set({ status: "cancelled" })
        .where(and(eq(schema.notifications.appointmentId, appt.id), eq(schema.notifications.status, "queued"), eq(schema.notifications.template, "reminder")));
    }
    if (template === "confirmation" || template === "rescheduled") {
      await scheduleReminder(tx, business, appt.id, client, ctx, phone);
    }
    if (!rows.length) return [];
    const inserted = await tx.insert(schema.notifications).values(rows).returning({ id: schema.notifications.id });
    return inserted.map((r) => r.id);
  });
  if (ids.length) after(() => deliverMany(business.id, ids));
}

async function scheduleReminder(
  tx: TenantDb,
  business: typeof schema.businesses.$inferSelect,
  appointmentId: string,
  client: typeof schema.clients.$inferSelect,
  ctx: ApptContext,
  phone: string | null,
) {
  // Replace any existing reminder (time may have changed).
  await tx
    .update(schema.notifications)
    .set({ status: "cancelled" })
    .where(and(eq(schema.notifications.appointmentId, appointmentId), eq(schema.notifications.status, "queued"), eq(schema.notifications.template, "reminder")));
  const at = new Date(ctx.startAt.getTime() - business.reminderHours * 3_600_000);
  if (at <= new Date()) return;
  const t = templates.reminder(ctx);
  const rows: (typeof schema.notifications.$inferInsert)[] = [];
  if (client.emailOptIn && client.email) rows.push({ businessId: business.id, clientId: client.id, appointmentId, channel: "email", template: "reminder", recipient: client.email, subject: t.subject, body: t.html, scheduledAt: at });
  if (client.smsOptIn && phone) rows.push({ businessId: business.id, clientId: client.id, appointmentId, channel: "sms", template: "reminder", recipient: phone, body: t.sms, scheduledAt: at });
  if (rows.length) await tx.insert(schema.notifications).values(rows);
}

/** Queue a one-off message (e.g. staff invitation) and send it after the response. */
export async function queueOneOff(businessId: string, input: { channel: "email" | "sms"; template: string; recipient: string; subject?: string; body: string }) {
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

async function send(n: Row): Promise<Outcome> {
  const configured = n.channel === "email" ? emailConfigured() : smsConfigured();
  if (!configured) return { id: n.id, status: "skipped", error: `${n.channel} provider not configured` };
  try {
    const r = n.channel === "email" ? await sendEmail({ to: n.recipient, subject: n.subject ?? "", html: n.body }) : await sendSms({ to: n.recipient, body: n.body });
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
async function deliverClaimed(rows: Row[]): Promise<Summary> {
  const summary: Summary = { processed: rows.length, sent: 0, failed: 0, skipped: 0 };
  if (!rows.length) return summary;
  const outcomes = await pooled(rows, CONCURRENCY, send);
  const byBusiness = new Map<string, Outcome[]>();
  rows.forEach((r, i) => {
    const o = outcomes[i]!;
    summary[o.status]++;
    byBusiness.set(r.businessId, [...(byBusiness.get(r.businessId) ?? []), o]);
  });
  for (const [businessId, list] of byBusiness) {
    await withTenant(businessId, async (tx) => {
      for (const o of list) {
        await tx
          .update(schema.notifications)
          .set(o.status === "sent" ? { status: "sent", sentAt: new Date(), providerId: o.providerId, error: null } : { status: o.status, error: o.error })
          .where(and(eq(schema.notifications.id, o.id), eq(schema.notifications.status, "sending")));
      }
    });
  }
  return summary;
}

export type Summary = { processed: number; sent: number; failed: number; skipped: number };

/** Deliver specific rows now (used right after a response). Rows not yet due are left queued. */
export async function deliverMany(businessId: string, ids: string[]): Promise<Summary> {
  if (!ids.length) return { processed: 0, sent: 0, failed: 0, skipped: 0 };
  const rows = await withTenant(businessId, (tx) => claim(tx, { ids, limit: ids.length }));
  return deliverClaimed(rows);
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
  const claimed: Row[] = [];
  for (const { businessId } of due) {
    claimed.push(...(await withTenant(businessId, (tx) => claim(tx, { limit: limitPerBusiness }))));
  }
  return deliverClaimed(claimed);
}
