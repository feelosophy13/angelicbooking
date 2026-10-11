/**
 * Marketing: one-off campaigns to a filtered client list, and automated
 * messages (birthday, win-back, rebook). Everything goes through the
 * notifications table so delivery, opt-outs, logs and SMS metering are shared
 * with transactional messages.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema, withJobs, withTenant, type CampaignAudience, type TenantDb } from "@angelic/db";
import { instantToISODate, normalizePhone } from "@angelic/core";
import { appUrl } from "@/lib/stripe";
import { marketingEmail } from "@/lib/notify/templates";
import { deliverMany } from "@/lib/notify";
import { smsWithStopNotice } from "@/lib/notify/sms";

type Business = typeof schema.businesses.$inferSelect;

export class MarketingError extends Error {}

// ---------------------------------------------------------------------------
// Unsubscribe links (email). Token = HMAC over business + client ids.
// ---------------------------------------------------------------------------
function unsubSig(businessId: string, clientId: string): string {
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "dev").update(`unsub:${businessId}:${clientId}`).digest("base64url").slice(0, 32);
}

export function unsubscribeUrl(business: Business, clientId: string): string {
  return appUrl(`/book/${business.slug}/unsubscribe/${clientId}.${unsubSig(business.id, clientId)}`);
}

export async function applyUnsubscribe(business: Business, token: string): Promise<boolean> {
  const [clientId, sig] = token.split(".");
  if (!clientId || !sig) return false;
  const expected = unsubSig(business.id, clientId);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return false;
  await withTenant(business.id, (tx) => tx.update(schema.clients).set({ emailOptIn: false }).where(eq(schema.clients.id, clientId)));
  return true;
}

// ---------------------------------------------------------------------------
// Placeholders shared by campaigns and automations
// ---------------------------------------------------------------------------
export const PLACEHOLDERS = ["{first_name}", "{business}", "{booking_url}", "{points}"] as const;

export function renderText(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? m : String(vars[k])));
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------
type ClientRow = typeof schema.clients.$inferSelect;

/** Clients matching an audience filter who can be reached on `channel`. */
export async function audienceClients(tx: TenantDb, business: Business, audience: CampaignAudience, channel: "email" | "sms"): Promise<ClientRow[]> {
  const visits = tx
    .select({
      clientId: schema.appointments.clientId,
      lastVisit: sql<Date | null>`max(${schema.appointmentItems.startAt}) filter (where ${schema.appointments.status} = 'completed')`.as("last_visit"),
      visits: sql<number>`count(*) filter (where ${schema.appointments.status} = 'completed')`.as("visits"),
    })
    .from(schema.appointments)
    .innerJoin(schema.appointmentItems, and(eq(schema.appointmentItems.appointmentId, schema.appointments.id), eq(schema.appointmentItems.sortOrder, 0)))
    .groupBy(schema.appointments.clientId)
    .as("v");
  const conds = [channel === "email" ? and(eq(schema.clients.emailOptIn, true), sql`${schema.clients.email} is not null and ${schema.clients.email} <> ''`) : and(eq(schema.clients.smsOptIn, true), sql`${schema.clients.phone} is not null and ${schema.clients.phone} <> ''`)];
  const now = Date.now();
  if (audience.visitedWithinDays) conds.push(sql`v.last_visit >= ${new Date(now - audience.visitedWithinDays * 86_400_000)}`);
  if (audience.lapsedDays) conds.push(sql`v.last_visit is not null and v.last_visit <= ${new Date(now - audience.lapsedDays * 86_400_000)}`);
  if (audience.neverVisited) conds.push(sql`coalesce(v.visits, 0) = 0`);
  if (audience.tag) conds.push(sql`${audience.tag} = any(${schema.clients.tags})`);
  if (audience.locationId) conds.push(eq(schema.clients.homeLocationId, audience.locationId));
  if (audience.serviceId) conds.push(sql`exists (select 1 from appointment_items ai join appointments a on a.id = ai.appointment_id where a.client_id = ${schema.clients.id} and ai.service_id = ${audience.serviceId} and a.status <> 'cancelled')`);
  if (audience.staffId) conds.push(sql`exists (select 1 from appointment_items ai join appointments a on a.id = ai.appointment_id where a.client_id = ${schema.clients.id} and ai.staff_id = ${audience.staffId} and a.status <> 'cancelled')`);
  const rows = await tx
    .select({ c: schema.clients })
    .from(schema.clients)
    .leftJoin(visits, eq(visits.clientId, schema.clients.id))
    .where(and(...conds))
    .orderBy(asc(schema.clients.lastName), asc(schema.clients.firstName));
  return rows.map((r) => r.c);
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
export async function listCampaigns(businessId: string) {
  return withTenant(businessId, (tx) => tx.select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt)).limit(100));
}

export async function getCampaign(businessId: string, id: string) {
  return withTenant(businessId, (tx) => tx.query.campaigns.findFirst({ where: eq(schema.campaigns.id, id) }));
}

export async function previewCampaign(business: Business, id: string) {
  return withTenant(business.id, async (tx) => {
    const c = await tx.query.campaigns.findFirst({ where: eq(schema.campaigns.id, id) });
    if (!c) return null;
    const clients = await audienceClients(tx, business, c.audience, c.channel);
    return { campaign: c, count: clients.length, sample: clients.slice(0, 8) };
  });
}

/** Queue one message per matching client and mark the campaign sent. */
export async function sendCampaign(business: Business, id: string, actorUserId: string): Promise<number> {
  const ids = await withTenant(business.id, async (tx) => {
    const c = await tx.query.campaigns.findFirst({ where: eq(schema.campaigns.id, id) });
    if (!c) throw new MarketingError("Campaign not found.");
    if (c.status === "sent") throw new MarketingError("This campaign was already sent.");
    const clients = await audienceClients(tx, business, c.audience, c.channel);
    if (!clients.length) throw new MarketingError("Nobody matches this audience on that channel.");
    const bookingUrl = appUrl(`/book/${business.slug}`);
    const brand = { businessName: business.name, logoUrl: business.logoUrl, brandColor: business.brandColor, businessPhone: business.phone, address: business.addressLine };
    const rows: (typeof schema.notifications.$inferInsert)[] = [];
    for (const cl of clients) {
      const vars = { first_name: cl.firstName, business: business.name, booking_url: bookingUrl };
      if (c.channel === "email") {
        const t = marketingEmail(brand, { subject: renderText(c.subject ?? c.name, vars), text: renderText(c.body, vars), ctaUrl: bookingUrl, unsubscribeUrl: unsubscribeUrl(business, cl.id) });
        rows.push({ businessId: business.id, clientId: cl.id, channel: "email", template: "campaign", recipient: cl.email!, subject: t.subject, body: t.html, campaignId: c.id });
      } else {
        const phone = normalizePhone(cl.phone);
        if (!phone) continue;
        rows.push({ businessId: business.id, clientId: cl.id, channel: "sms", template: "campaign", recipient: phone, body: await smsWithStopNotice(tx, cl, `${business.name}: ${renderText(c.body, vars)}`, true), campaignId: c.id });
      }
    }
    const inserted = rows.length ? await tx.insert(schema.notifications).values(rows).returning({ id: schema.notifications.id }) : [];
    await tx.update(schema.campaigns).set({ status: "sent", sentAt: new Date(), recipientCount: inserted.length }).where(eq(schema.campaigns.id, c.id));
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: "campaign.send", entity: "campaign", entityId: c.id, diff: JSON.stringify({ recipients: inserted.length, channel: c.channel }) });
    return inserted.map((r) => r.id);
  });
  // Deliver after the response; the cron picks up anything left.
  if (ids.length) after(() => deliverMany(business.id, ids).catch((e) => console.error("[campaign] delivery failed", (e as Error).message)));
  return ids.length;
}

export async function campaignStats(businessId: string, campaignId: string) {
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .select({
        sent: sql<number>`count(*) filter (where ${schema.notifications.status} = 'sent')`,
        failed: sql<number>`count(*) filter (where ${schema.notifications.status} in ('failed','skipped'))`,
        pending: sql<number>`count(*) filter (where ${schema.notifications.status} in ('queued','sending'))`,
      })
      .from(schema.notifications)
      .where(eq(schema.notifications.campaignId, campaignId));
    return { sent: Number(row?.sent ?? 0), failed: Number(row?.failed ?? 0), pending: Number(row?.pending ?? 0) };
  });
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------
export type AutomationKind = "pre_visit" | "birthday" | "win_back" | "rebook";
export const AUTOMATION_DEFAULTS: Record<AutomationKind, { title: string; description: string; days: number; hoursBefore: number; subject: string; body: string }> = {
  pre_visit: { title: "Pre-visit message", description: "Sent a set number of hours before each appointment, in addition to the standard reminder. Good for prep instructions.", days: 0, hoursBefore: 48, subject: "Getting ready for your visit to {business}", body: "Hi {first_name}, your {service} with {staff} is {when}. Please arrive 5 minutes early with clean, make-up-free skin. Need to change it? {manage_url}" },
  birthday: { title: "Birthday message", description: "Sent on the client's birthday (from the birthday on their profile).", days: 0, hoursBefore: 0, subject: "Happy birthday from {business}!", body: "Happy birthday, {first_name}! 🎉 Treat yourself this month and we'll make it special. Book at {booking_url}" },
  win_back: { title: "We miss you", description: "Sent once when a client hasn't visited for this many days.", days: 60, hoursBefore: 0, subject: "We miss you at {business}", body: "Hi {first_name}, it's been a while! We'd love to see you again. Book your next visit at {booking_url}" },
  rebook: { title: "Rebook reminder", description: "Sent this many days after a visit when nothing else is booked.", days: 28, hoursBefore: 0, subject: "Time for your next visit?", body: "Hi {first_name}, it's about time for your next appointment at {business}. Grab a time that suits you: {booking_url}" },
};

export async function listAutomations(businessId: string) {
  const rows = await withTenant(businessId, (tx) => tx.select().from(schema.automations));
  return (Object.keys(AUTOMATION_DEFAULTS) as AutomationKind[]).map((kind) => {
    const row = rows.find((r) => r.kind === kind);
    const d = AUTOMATION_DEFAULTS[kind];
    return { kind, title: d.title, description: d.description, enabled: row?.enabled ?? false, channel: row?.channel ?? "email", days: row?.days ?? d.days, hoursBefore: row?.hoursBefore ?? d.hoursBefore, subject: row?.subject ?? d.subject, body: row?.body ?? d.body, id: row?.id ?? null };
  });
}

export async function saveAutomation(businessId: string, kind: AutomationKind, input: { enabled: boolean; channel: string; days: number; hoursBefore: number; subject: string | null; body: string }) {
  await withTenant(businessId, (tx) =>
    tx
      .insert(schema.automations)
      .values({ businessId, kind, ...input })
      .onConflictDoUpdate({ target: [schema.automations.businessId, schema.automations.kind], set: { ...input, updatedAt: new Date() } }),
  );
}

/**
 * Daily evaluation for every business with an enabled automation. Safe to run
 * every few minutes: each (automation, client, period) sends at most once, and
 * sends only happen between 9am and 8pm local time.
 */
export async function runAutomations(now = new Date()): Promise<{ businesses: number; queued: number }> {
  const enabled = await withJobs((tx) => tx.selectDistinct({ businessId: schema.automations.businessId }).from(schema.automations).where(eq(schema.automations.enabled, true)));
  let queued = 0;
  for (const { businessId } of enabled) {
    const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
    if (!business) continue;
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: business.timezone, hour: "numeric", hour12: false }).format(now)) % 24;
    if (hour < 9 || hour >= 20) continue;
    queued += await runAutomationsFor(business, now);
  }
  return { businesses: enabled.length, queued };
}

async function runAutomationsFor(business: Business, now: Date): Promise<number> {
  const bookingUrl = appUrl(`/book/${business.slug}`);
  const brand = { businessName: business.name, logoUrl: business.logoUrl, brandColor: business.brandColor, businessPhone: business.phone, address: business.addressLine };
  const today = instantToISODate(now, business.timezone);
  return withTenant(business.id, async (tx) => {
    const autos = await tx.select().from(schema.automations).where(eq(schema.automations.enabled, true));
    let n = 0;
    for (const a of autos) {
      if (a.kind === "pre_visit") continue; // scheduled per appointment at booking time (lib/notify)
      let targets: { client: typeof schema.clients.$inferSelect; periodKey: string }[] = [];
      if (a.kind === "birthday") {
        const rows = await tx.select().from(schema.clients).where(sql`${schema.clients.birthday} is not null and to_char(${schema.clients.birthday}, 'MM-DD') = ${today.slice(5)}`);
        targets = rows.map((client) => ({ client, periodKey: today.slice(0, 4) }));
      } else {
        // Last completed visit per client, with whether anything is booked ahead.
        const rows = await tx.execute<{ client_id: string; appointment_id: string; last_visit: string; has_upcoming: boolean }>(sql`
          select v.client_id, v.appointment_id, v.last_visit,
                 exists (select 1 from appointments a2 join appointment_items i2 on i2.appointment_id = a2.id
                         where a2.client_id = v.client_id and a2.status in ('booked','confirmed') and i2.start_at > now()) as has_upcoming
          from (
            select distinct on (a.client_id) a.client_id, a.id as appointment_id, i.start_at as last_visit
            from appointments a join appointment_items i on i.appointment_id = a.id and i.sort_order = 0
            where a.status = 'completed' and a.client_id is not null
            order by a.client_id, i.start_at desc
          ) v`);
        const cutoff = now.getTime() - a.days * 86_400_000;
        const due: { clientId: string; periodKey: string }[] = [];
        for (const r of rows) {
          if (r.has_upcoming) continue;
          const last = new Date(r.last_visit).getTime();
          // win-back: anyone lapsed past the threshold; rebook: a 3-day window after the threshold so
          // enabling it later doesn't message every old client at once.
          const hit = a.kind === "win_back" ? last <= cutoff : last <= cutoff && last > cutoff - 3 * 86_400_000;
          if (hit) due.push({ clientId: r.client_id, periodKey: r.appointment_id });
        }
        const ids = [...new Set(due.map((d) => d.clientId))];
        const clients = ids.length ? await tx.select().from(schema.clients).where(inArray(schema.clients.id, ids)) : [];
        targets = due.flatMap((d) => {
          const client = clients.find((c) => c.id === d.clientId);
          return client ? [{ client, periodKey: d.periodKey }] : [];
        });
      }
      for (const { client, periodKey } of targets) {
        const claimed = await tx.insert(schema.automationSends).values({ businessId: business.id, automationId: a.id, clientId: client.id, periodKey }).onConflictDoNothing().returning({ id: schema.automationSends.id });
        if (!claimed.length) continue;
        const vars = { first_name: client.firstName, business: business.name, booking_url: bookingUrl };
        const rows: (typeof schema.notifications.$inferInsert)[] = [];
        const wantEmail = a.channel === "email" || a.channel === "both";
        const wantSms = a.channel === "sms" || a.channel === "both";
        if (wantEmail && client.emailOptIn && client.email) {
          const t = marketingEmail(brand, { subject: renderText(a.subject ?? AUTOMATION_DEFAULTS[a.kind].subject, vars), text: renderText(a.body, vars), ctaUrl: bookingUrl, unsubscribeUrl: unsubscribeUrl(business, client.id) });
          rows.push({ businessId: business.id, clientId: client.id, channel: "email", template: `auto_${a.kind}`, recipient: client.email, subject: t.subject, body: t.html });
        }
        const phone = normalizePhone(client.phone);
        if (wantSms && client.smsOptIn && phone) rows.push({ businessId: business.id, clientId: client.id, channel: "sms", template: `auto_${a.kind}`, recipient: phone, body: await smsWithStopNotice(tx, client, `${business.name}: ${renderText(a.body, vars)}`, true) });
        if (rows.length) {
          await tx.insert(schema.notifications).values(rows);
          n += rows.length;
        }
      }
    }
    return n;
  });
}

// keep imports used
void isNull; void lt;

/** Vars for appointment-driven automations (pre-visit). */
export function appointmentVars(business: Business, ctx: { clientFirstName: string; services: string; staffName: string; startAt: Date; manageUrl: string; formsUrl?: string | null; timeZone?: string; businessName?: string }) {
  const d = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: ctx.timeZone ?? business.timezone }).format(ctx.startAt);
  return { first_name: ctx.clientFirstName, business: ctx.businessName ?? business.name, booking_url: appUrl(`/book/${business.slug}`), service: ctx.services, staff: ctx.staffName, when: d, manage_url: ctx.manageUrl, forms_url: ctx.formsUrl ?? "" };
}
