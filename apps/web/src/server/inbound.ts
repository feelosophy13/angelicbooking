/**
 * Replies clients text to the business's number: stored, matched to a
 * client, surfaced on the client page and in the inbox. STOP/START keywords
 * update the client's text opt-in (Twilio also enforces STOP at the carrier
 * level for toll-free numbers).
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema, withJobs, withTenant } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { queueOneOff } from "@/lib/notify";

const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START = new Set(["START", "YES", "UNSTOP", "SUBSCRIBE"]);

/** Called by the Twilio webhook after signature validation. Returns the business matched, if any. */
export async function recordInboundSms(input: { from: string; to: string; body: string; sid: string | null }) {
  const to = normalizePhone(input.to) ?? input.to;
  const number = await withJobs((tx) => tx.query.messagingNumbers.findFirst({ where: and(eq(schema.messagingNumbers.phoneNumber, to), isNull(schema.messagingNumbers.releasedAt)) }));
  if (!number) return null;
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, number.businessId) });
  if (!business) return null;
  const from = normalizePhone(input.from) ?? input.from;
  await withTenant(business.id, async (tx) => {
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.phone, from) });
    const inserted = await tx
      .insert(schema.inboundMessages)
      .values({ businessId: business.id, clientId: client?.id ?? null, fromNumber: from, toNumber: to, body: input.body.slice(0, 2000), providerSid: input.sid })
      .onConflictDoNothing()
      .returning({ id: schema.inboundMessages.id });
    if (!inserted.length || !client) return;
    const word = input.body.trim().toUpperCase().split(/\s+/)[0] ?? "";
    if (STOP.has(word)) await tx.update(schema.clients).set({ smsOptIn: false }).where(eq(schema.clients.id, client.id));
    else if (START.has(word)) await tx.update(schema.clients).set({ smsOptIn: true }).where(eq(schema.clients.id, client.id));
  });
  return business;
}

/** Inbound replies and outbound texts for a client, newest last. */
export async function clientThread(businessId: string, clientId: string, limit = 50) {
  return withTenant(businessId, async (tx) => {
    const [inbound, outbound] = await Promise.all([
      tx.select().from(schema.inboundMessages).where(eq(schema.inboundMessages.clientId, clientId)).orderBy(desc(schema.inboundMessages.receivedAt)).limit(limit),
      tx.select().from(schema.notifications).where(and(eq(schema.notifications.clientId, clientId), eq(schema.notifications.channel, "sms"))).orderBy(desc(schema.notifications.createdAt)).limit(limit),
    ]);
    const items = [
      ...inbound.map((m) => ({ id: m.id, dir: "in" as const, body: m.body, at: m.receivedAt, status: "received" })),
      ...outbound.map((n) => ({ id: n.id, dir: "out" as const, body: n.body, at: n.sentAt ?? n.scheduledAt, status: n.status })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    return items.slice(-limit);
  });
}

export async function listInbox(businessId: string, limit = 100) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ m: schema.inboundMessages, firstName: schema.clients.firstName, lastName: schema.clients.lastName })
      .from(schema.inboundMessages)
      .leftJoin(schema.clients, eq(schema.clients.id, schema.inboundMessages.clientId))
      .orderBy(desc(schema.inboundMessages.receivedAt))
      .limit(limit),
  );
}

export async function unreadCount(businessId: string) {
  const [r] = await withTenant(businessId, (tx) => tx.select({ n: sql<number>`count(*)` }).from(schema.inboundMessages).where(isNull(schema.inboundMessages.readAt)));
  return Number(r?.n ?? 0);
}

export async function markRead(businessId: string, ids: string[]) {
  if (!ids.length) return;
  await withTenant(businessId, (tx) => tx.update(schema.inboundMessages).set({ readAt: new Date() }).where(or(...ids.map((id) => eq(schema.inboundMessages.id, id)))));
}

/** Staff reply from the client page. */
export async function sendStaffText(business: typeof schema.businesses.$inferSelect, clientId: string, body: string) {
  const client = await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) }));
  const phone = normalizePhone(client?.phone);
  if (!client || !phone) throw new Error("This client has no mobile number.");
  if (!client.smsOptIn) throw new Error("This client has opted out of texts.");
  await queueOneOff(business.id, { channel: "sms", template: "staff_reply", recipient: phone, body: body.trim().slice(0, 1000), clientId: client.id });
}

export type Conversation = {
  /** Client id, or `tel:<number>` for a sender who is not (yet) a client. */
  key: string;
  clientId: string | null;
  name: string;
  phone: string;
  smsOptIn: boolean;
  lastBody: string;
  lastAt: Date;
  lastDir: "in" | "out";
  unread: number;
};

/** One row per person the business has texted with, newest conversation first. Capped at `limit` conversations. */
export async function listConversations(businessId: string, limit = 200): Promise<Conversation[]> {
  return withTenant(businessId, async (tx) => {
    const [inbound, outbound] = await Promise.all([
      tx.select().from(schema.inboundMessages).orderBy(desc(schema.inboundMessages.receivedAt)).limit(2000),
      tx.select().from(schema.notifications).where(and(eq(schema.notifications.channel, "sms"), sql`${schema.notifications.clientId} is not null`, inArray(schema.notifications.status, ["sent", "sending", "queued"]))).orderBy(desc(schema.notifications.createdAt)).limit(2000),
    ]);
    const byKey = new Map<string, Conversation>();
    const bump = (key: string, base: Omit<Conversation, "lastBody" | "lastAt" | "lastDir" | "unread">, m: { body: string; at: Date; dir: "in" | "out"; unread: boolean }) => {
      const cur = byKey.get(key);
      if (!cur) byKey.set(key, { ...base, lastBody: m.body, lastAt: m.at, lastDir: m.dir, unread: m.unread ? 1 : 0 });
      else {
        if (m.at > cur.lastAt) Object.assign(cur, { lastBody: m.body, lastAt: m.at, lastDir: m.dir });
        if (m.unread) cur.unread += 1;
      }
    };
    for (const m of inbound) bump(m.clientId ?? `tel:${m.fromNumber}`, { key: m.clientId ?? `tel:${m.fromNumber}`, clientId: m.clientId, name: m.fromNumber, phone: m.fromNumber, smsOptIn: true }, { body: m.body, at: m.receivedAt, dir: "in", unread: !m.readAt });
    // Outbound texts only add context to a client who has already written (or who the desk has texted by hand).
    for (const n of outbound) if (n.clientId && (byKey.has(n.clientId) || n.template === "staff_reply")) bump(n.clientId, { key: n.clientId, clientId: n.clientId, name: n.recipient, phone: n.recipient, smsOptIn: true }, { body: n.body, at: n.sentAt ?? n.scheduledAt, dir: "out", unread: false });
    const ids = [...byKey.values()].flatMap((c) => (c.clientId ? [c.clientId] : []));
    if (ids.length) {
      const people = await tx.select({ id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName, phone: schema.clients.phone, smsOptIn: schema.clients.smsOptIn }).from(schema.clients).where(inArray(schema.clients.id, ids));
      for (const p of people) {
        const c = byKey.get(p.id);
        if (c) Object.assign(c, { name: `${p.firstName} ${p.lastName}`.trim() || c.name, phone: p.phone ?? c.phone, smsOptIn: p.smsOptIn });
      }
    }
    return [...byKey.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime()).slice(0, limit);
  });
}

/** Texts from one sender who is not a client: the thread for a `tel:` key. */
export async function numberThread(businessId: string, number: string, limit = 50) {
  return withTenant(businessId, async (tx) => {
    const rows = await tx.select().from(schema.inboundMessages).where(and(isNull(schema.inboundMessages.clientId), eq(schema.inboundMessages.fromNumber, number))).orderBy(desc(schema.inboundMessages.receivedAt)).limit(limit);
    return rows.map((m) => ({ id: m.id, dir: "in" as const, body: m.body, at: m.receivedAt, status: "received" })).reverse();
  });
}

/** Mark everything a client (or an unknown number) has sent as read. */
export async function markConversationRead(businessId: string, key: string) {
  await withTenant(businessId, (tx) =>
    tx
      .update(schema.inboundMessages)
      .set({ readAt: new Date() })
      .where(and(isNull(schema.inboundMessages.readAt), key.startsWith("tel:") ? and(isNull(schema.inboundMessages.clientId), eq(schema.inboundMessages.fromNumber, key.slice(4))) : eq(schema.inboundMessages.clientId, key))),
  );
}
