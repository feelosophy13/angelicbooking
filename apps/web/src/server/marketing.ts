/**
 * Marketing: one-off campaigns to a filtered client list, and automated
 * messages (birthday, win-back, rebook). Everything goes through the
 * notifications table so delivery, opt-outs, logs and SMS metering are shared
 * with transactional messages.
 */
import { unsubscribeUrl, verifyUnsubscribe } from "@/lib/unsubscribe";
import { after } from "next/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { schema, withTenant, type CampaignAudience, type TenantDb } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { appUrl } from "@/lib/stripe";
import { marketingEmail } from "@/lib/notify/templates";
import { renderEmail } from "@/lib/email-design";
import { baseVars, brandOf, markUrl, savedDesign } from "@/server/email-designs";
import { deliverMany } from "@/lib/notify";
import { smsWithStopNotice } from "@/lib/notify/sms";
import { deferToDaytime } from "@/lib/workflows-logic";
import { locationTimeZones, NO_POSTAL_ADDRESS, postalAddress } from "./locations";
import { siteUrl } from "@/lib/site-url";
import { phoneTail } from "@/server/consent";

type Business = typeof schema.businesses.$inferSelect;

export class MarketingError extends Error {}

// ---------------------------------------------------------------------------
// Unsubscribe links (email): see lib/unsubscribe.ts
// ---------------------------------------------------------------------------
export { unsubscribeUrl, verifyUnsubscribe } from "@/lib/unsubscribe";

/** Unsubscribe turns off marketing email only; appointment confirmations, reminders and receipts still go (as the page says). */
export async function applyUnsubscribe(business: { id: string }, token: string): Promise<boolean> {
  const clientId = verifyUnsubscribe(business, token);
  if (!clientId) return false;
  await withTenant(business.id, (tx) => tx.update(schema.clients).set({ emailMarketingOptIn: false }).where(eq(schema.clients.id, clientId)));
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
  // Marketing consent, not just appointment-message consent: marketing texts need the client's written opt-in (TCPA), and a number on
  // the STOP list is never texted whichever record it is on.
  const conds = [
    channel === "email"
      ? and(eq(schema.clients.emailOptIn, true), eq(schema.clients.emailMarketingOptIn, true), sql`${schema.clients.email} is not null and ${schema.clients.email} <> ''`)
      : and(eq(schema.clients.smsOptIn, true), eq(schema.clients.smsMarketingOptIn, true), sql`${schema.clients.phone} is not null and ${schema.clients.phone} <> ''`, sql`not exists (select 1 from sms_suppressions ss where ss.business_id = ${schema.clients.businessId} and ss.phone_tail = right(regexp_replace(${schema.clients.phone}, '\D', '', 'g'), 10))`),
  ];
  const now = Date.now();
  // ISO strings, not Date objects: a raw Date in a sql`` parameter is rejected by the postgres driver.
  if (audience.visitedWithinDays) conds.push(sql`v.last_visit >= ${new Date(now - audience.visitedWithinDays * 86_400_000).toISOString()}::timestamptz`);
  if (audience.lapsedDays) conds.push(sql`v.last_visit is not null and v.last_visit <= ${new Date(now - audience.lapsedDays * 86_400_000).toISOString()}::timestamptz`);
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
    // Lock the row: a second send waits here until the first commits, then sees "sent" and stops (no double texting).
    const [c] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).for("update");
    if (!c) throw new MarketingError("Campaign not found.");
    if (c.status === "sent") throw new MarketingError("This campaign was already sent.");
    const clients = await audienceClients(tx, business, c.audience, c.channel);
    if (!clients.length) throw new MarketingError("Nobody matches this audience on that channel.");
    const bookingUrl = siteUrl(business);
    const address = await postalAddress(tx, business);
    if (c.channel === "email" && !address) throw new MarketingError(NO_POSTAL_ADDRESS);
    const brand = { businessName: business.name, logoUrl: business.logoUrl, brandColor: business.brandColor, businessPhone: business.phone, address };
    // Laid out in the designer when the campaign picked a saved design; its plain message otherwise.
    const design = c.channel === "email" ? await savedDesign(tx, c.templateId) : null;
    if (c.channel === "email" && !design && !c.body.trim()) throw new MarketingError(c.templateId ? "The design this campaign used was deleted. Pick another design or write a message." : "Write a message or pick a design first.");
    const rows: (typeof schema.notifications.$inferInsert)[] = [];
    // Texts wait for daytime where the client is (their usual location's time zone); emails go now.
    const zoneOf = await locationTimeZones(tx, business);
    const now = new Date();
    const at = (cl: ClientRow) => (c.channel === "sms" ? deferToDaytime(now, zoneOf(cl.homeLocationId)) : now);
    // One message per address: family members sharing a phone, or duplicate records, get it once (and are charged once).
    const seen = new Set<string>();
    for (const cl of clients) {
      const key = c.channel === "email" ? (cl.email ?? "").trim().toLowerCase() : phoneTail(cl.phone);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const vars = { first_name: cl.firstName, business: business.name, booking_url: bookingUrl };
      if (c.channel === "email") {
        const unsub = unsubscribeUrl(business, cl.id);
        const t = design
          ? renderEmail({ ...design, subject: c.subject || design.subject || c.name }, { brand: brandOf(brand), vars: { ...baseVars(business, brand, cl), unsubscribe_url: unsub }, marketing: { unsubscribeUrl: unsub, address: address! }, markUrl: markUrl() })
          : marketingEmail(brand, { subject: renderText(c.subject ?? c.name, vars), text: renderText(c.body, vars), ctaUrl: bookingUrl, unsubscribeUrl: unsub });
        rows.push({ businessId: business.id, clientId: cl.id, channel: "email", template: "campaign", recipient: cl.email!, subject: t.subject, body: t.html, campaignId: c.id, marketing: true, scheduledAt: at(cl) });
      } else {
        const phone = normalizePhone(cl.phone);
        if (!phone) continue;
        rows.push({ businessId: business.id, clientId: cl.id, channel: "sms", template: "campaign", recipient: phone, body: await smsWithStopNotice(tx, cl, `${business.name}: ${renderText(c.body, vars)}`, true), campaignId: c.id, marketing: true, scheduledAt: at(cl) });
      }
    }
    const inserted = rows.length ? await tx.insert(schema.notifications).values(rows).returning({ id: schema.notifications.id }) : [];
    await tx.update(schema.campaigns).set({ status: "sent", sentAt: new Date(), recipientCount: inserted.length }).where(eq(schema.campaigns.id, c.id));
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: "campaign.send", entity: "campaign", entityId: c.id, diff: JSON.stringify({ recipients: inserted.length, channel: c.channel }) });
    return inserted.map((r) => r.id);
  });
  // Deliver after the response (texts held for quiet hours stay queued for the cron); the cron picks up anything left.
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
// Automations are workflows now (server/workflows.ts). The `automations` table only
// feeds the one-time conversion in ensureTemplates().
// ---------------------------------------------------------------------------

/** Vars for appointment-driven workflow messages. */
export function appointmentVars(business: Business, ctx: { clientFirstName: string; services: string; staffName: string; startAt: Date; manageUrl: string; formsUrl?: string | null; timeZone?: string; businessName?: string }) {
  const d = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: ctx.timeZone ?? business.timezone }).format(ctx.startAt);
  return { first_name: ctx.clientFirstName, business: ctx.businessName ?? business.name, booking_url: siteUrl(business), service: ctx.services, staff: ctx.staffName, when: d, manage_url: ctx.manageUrl, forms_url: ctx.formsUrl ?? "" };
}
