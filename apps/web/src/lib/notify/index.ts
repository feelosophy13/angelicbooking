import { and, asc, eq, lte, sql } from "drizzle-orm";
import { after } from "next/server";
import { db, schema, withTenant, type TenantDb } from "@angelic/db";
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

async function deliverOne(tx: TenantDb, n: Row) {
  const configured = n.channel === "email" ? emailConfigured() : smsConfigured();
  if (!configured) {
    await tx.update(schema.notifications).set({ status: "skipped", error: `${n.channel} provider not configured` }).where(eq(schema.notifications.id, n.id));
    return;
  }
  try {
    const r = n.channel === "email" ? await sendEmail({ to: n.recipient, subject: n.subject ?? "", html: n.body }) : await sendSms({ to: n.recipient, body: n.body });
    await tx.update(schema.notifications).set({ status: "sent", sentAt: new Date(), providerId: r.id }).where(eq(schema.notifications.id, n.id));
  } catch (e) {
    await tx.update(schema.notifications).set({ status: "failed", error: (e as Error).message }).where(eq(schema.notifications.id, n.id));
  }
}

export async function deliverMany(businessId: string, ids: string[]) {
  await withTenant(businessId, async (tx) => {
    for (const id of ids) {
      const n = await tx.query.notifications.findFirst({ where: and(eq(schema.notifications.id, id), eq(schema.notifications.status, "queued")) });
      if (n && n.scheduledAt <= new Date()) await deliverOne(tx, n);
    }
  });
}

/** Cron entry point: deliver everything due across all tenants. */
export async function deliverDue(limit = 200): Promise<{ processed: number }> {
  // Not tenant-scoped: find due rows via the admin-free path (RLS blocks the app role),
  // so we enumerate businesses with due work first.
  const due = await db.execute<{ business_id: string; n: number }>(
    sql`select business_id, count(*)::int as n from notifications where status = 'queued' and scheduled_at <= now() group by business_id limit 100`,
  );
  let processed = 0;
  for (const row of due) {
    const ids = await withTenant(row.business_id, (tx) =>
      tx
        .select({ id: schema.notifications.id })
        .from(schema.notifications)
        .where(and(eq(schema.notifications.status, "queued"), lte(schema.notifications.scheduledAt, new Date())))
        .orderBy(asc(schema.notifications.scheduledAt))
        .limit(limit),
    );
    await deliverMany(row.business_id, ids.map((i) => i.id));
    processed += ids.length;
  }
  return { processed };
}
