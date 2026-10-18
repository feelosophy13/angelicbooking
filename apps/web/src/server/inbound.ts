/**
 * Replies clients text to the business's number: stored, matched to a
 * client, surfaced on the client page and in the inbox. STOP/START keywords
 * update the client's text opt-in (Twilio also enforces STOP at the carrier
 * level for toll-free numbers). The owner is emailed when a new conversation
 * goes unread.
 */
import { isSmsSuppressed, suppressSms, unsuppressSms } from "./consent";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema, withJobs, withTenant, type TenantDb } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { queueOneOff } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";
import { filterConversations, sortConversations, type ConversationFilter } from "@/lib/inbox";

type Media = { url: string; type: string }[];

const STOP_ANYWHERE = new Set(["STOP", "STOPALL", "UNSUBSCRIBE"]);
const STOP_EXACT = new Set(["CANCEL", "END", "QUIT"]);
const START_EXACT = new Set(["START", "YES", "UNSTOP", "SUBSCRIBE"]);
const HELP_EXACT = new Set(["HELP", "INFO"]);

/**
 * What a reply means for the sender's opt-in. STOP is also recognised in a
 * short message ("please stop", "stop texting me"); CANCEL/END/QUIT and START
 * only when they are the whole message, since "cancel" is also an appointment word.
 */
export function classifyKeyword(body: string): "stop" | "start" | "help" | null {
  const words = body.toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (words.length === 1) {
    const w = words[0]!;
    if (STOP_ANYWHERE.has(w) || STOP_EXACT.has(w)) return "stop";
    if (START_EXACT.has(w)) return "start";
    if (HELP_EXACT.has(w)) return "help";
    return null;
  }
  if (words.length <= 4 && words.some((w) => STOP_ANYWHERE.has(w))) return "stop";
  return null;
}

/** US toll-free numbers answer STOP/HELP themselves (carrier-managed), so we must not answer a second time. */
const isTollFree = (n: string) => /^\+1(800|833|844|855|866|877|888)/.test(n);

/** The last ten digits of a phone, to match "(555) 555-0177", "5555550177" and "+15555550177" to each other. */
export const phoneTail = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);

/** The client whose phone is this number, however it was typed. Must run inside the tenant tx. */
export async function clientByPhone(tx: TenantDb, phone: string) {
  const tail = phoneTail(phone);
  if (tail.length < 7) return undefined;
  return tx.query.clients.findFirst({ where: sql`right(regexp_replace(${schema.clients.phone}, '\\D', '', 'g'), 10) = ${tail}`, orderBy: desc(schema.clients.createdAt) });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Called by the Twilio webhook after signature validation. Returns the business matched (if any) and an optional reply to send back. */
export async function recordInboundSms(input: { from: string; to: string; body: string; sid: string | null; media?: Media }) {
  const to = normalizePhone(input.to) ?? input.to;
  const number = await withJobs((tx) => tx.query.messagingNumbers.findFirst({ where: and(eq(schema.messagingNumbers.phoneNumber, to), isNull(schema.messagingNumbers.releasedAt)) }));
  if (!number) return { business: null, reply: null };
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, number.businessId) });
  if (!business) return { business: null, reply: null };
  const from = normalizePhone(input.from) ?? input.from;
  const keyword = classifyKeyword(input.body);
  const notify = await withTenant(business.id, async (tx): Promise<{ name: string; key: string } | null> => {
    const client = await clientByPhone(tx, from);
    const key = client?.id ?? `tel:${from}`;
    const [{ n: unreadBefore } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(schema.inboundMessages)
      .where(and(isNull(schema.inboundMessages.readAt), client ? eq(schema.inboundMessages.clientId, client.id) : and(isNull(schema.inboundMessages.clientId), eq(schema.inboundMessages.fromNumber, from))));
    const inserted = await tx
      .insert(schema.inboundMessages)
      .values({ businessId: business.id, clientId: client?.id ?? null, fromNumber: from, toNumber: to, body: input.body.slice(0, 2000), media: (input.media ?? []).slice(0, 10), providerSid: input.sid })
      .onConflictDoNothing()
      .returning({ id: schema.inboundMessages.id });
    if (!inserted.length) return null;
    // STOP covers the number, not one record: every client with it, anyone added with it later, and texts already queued to it.
    if (keyword === "stop") await suppressSms(tx, business.id, from, "stop");
    else if (keyword === "start") await unsuppressSms(tx, business.id, from);
    // Opt-out/in words are handled above and are not worth an email; anything else on a conversation nobody has read yet is.
    return !keyword && Number(unreadBefore) === 0 ? { name: client ? `${client.firstName} ${client.lastName}`.trim() : from, key } : null;
  });
  if (notify && business.email) {
    const { name, key } = notify;
    const link = appUrl(`/app/${business.slug}/inbox/${encodeURIComponent(key)}`);
    const text = input.body.trim() || (input.media?.length ? "(sent a picture)" : "");
    await queueOneOff(business.id, {
      channel: "email",
      template: "inbound_reply_staff",
      recipient: business.email,
      subject: `New text from ${name}`,
      body: `<p><strong>${esc(name)}</strong> texted ${esc(business.name)}:</p><blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #d6d3d1">${esc(text).replace(/\n/g, "<br>")}</blockquote><p><a href="${link}">Open the conversation</a> to reply.</p>`,
    }).catch((e) => console.error("[twilio/inbound] staff email failed", (e as Error).message));
  }
  const reply = keyword === "help" && !isTollFree(to) ? `${business.name}: for help call ${business.phone ?? "us"}${business.email ? ` or email ${business.email}` : ""}. Reply STOP to opt out.` : null;
  return { business, reply };
}

export type ThreadItem = {
  id: string;
  dir: "in" | "out";
  body: string;
  at: Date;
  /** Inbound: "received". Outbound: the notification's own status (queued | sending | sent | failed | skipped). */
  status: string;
  /** Outbound only: the carrier's receipt (delivered | undelivered | …) once it arrived. */
  deliveryStatus: string | null;
  /** Outbound only: why it stopped, in plain words. */
  error: string | null;
  /** Outbound only: which automated text this was ("reminder"), or "staff_reply" for one typed at the desk. */
  template: string | null;
  media: Media;
};

/** Inbound replies and outbound texts (automated ones included) for a client, oldest first, so the thread reads like a chat. */
export async function clientThread(businessId: string, clientId: string, limit = 50): Promise<ThreadItem[]> {
  return withTenant(businessId, async (tx) => {
    const [inbound, outbound] = await Promise.all([
      tx.select().from(schema.inboundMessages).where(eq(schema.inboundMessages.clientId, clientId)).orderBy(desc(schema.inboundMessages.receivedAt)).limit(limit),
      tx.select().from(schema.notifications).where(and(eq(schema.notifications.clientId, clientId), eq(schema.notifications.channel, "sms"))).orderBy(desc(schema.notifications.createdAt)).limit(limit),
    ]);
    const items: ThreadItem[] = [
      ...inbound.map((m) => ({ id: m.id, dir: "in" as const, body: m.body, at: m.receivedAt, status: "received", deliveryStatus: null, error: null, template: null, media: m.media ?? [] })),
      ...outbound.map((n) => ({ id: n.id, dir: "out" as const, body: n.body, at: n.sentAt ?? n.scheduledAt, status: n.status, deliveryStatus: n.deliveryStatus, error: n.error, template: n.template, media: n.media ?? [] })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    return items.slice(-limit);
  });
}

export type ConversationContext = {
  next: { id: string; startAt: Date; service: string; staff: string | null } | null;
  last: { id: string; startAt: Date; service: string } | null;
  completed: number;
};

/** What the desk needs beside a thread: the client's next booked visit, their last one, and how many they have had. */
export async function conversationContext(businessId: string, clientId: string): Promise<ConversationContext> {
  return withTenant(businessId, async (tx) => {
    const base = and(eq(schema.appointments.clientId, clientId), eq(schema.appointments.kind, "visit"), eq(schema.appointmentItems.sortOrder, 0));
    const cols = { id: schema.appointments.id, startAt: schema.appointmentItems.startAt, service: schema.appointmentItems.serviceName, staff: schema.staff.displayName };
    const from = () => tx.select(cols).from(schema.appointmentItems).innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId)).leftJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId));
    const [[next], [last], [n]] = await Promise.all([
      from().where(and(base, inArray(schema.appointments.status, ["booked", "confirmed", "checked_in", "in_progress"]), gte(schema.appointmentItems.startAt, new Date()))).orderBy(asc(schema.appointmentItems.startAt)).limit(1),
      from().where(and(base, eq(schema.appointments.status, "completed"))).orderBy(desc(schema.appointmentItems.startAt)).limit(1),
      tx.select({ n: sql<number>`count(*)` }).from(schema.appointmentItems).innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId)).where(and(base, eq(schema.appointments.status, "completed"))),
    ]);
    return { next: next ? { id: next.id, startAt: next.startAt, service: next.service, staff: next.staff } : null, last: last ? { id: last.id, startAt: last.startAt, service: last.service } : null, completed: Number(n?.n ?? 0) };
  });
}

export async function unreadCount(businessId: string) {
  const [r] = await withTenant(businessId, (tx) => tx.select({ n: sql<number>`count(*)` }).from(schema.inboundMessages).where(isNull(schema.inboundMessages.readAt)));
  return Number(r?.n ?? 0);
}

export async function markRead(businessId: string, ids: string[]) {
  if (!ids.length) return;
  await withTenant(businessId, (tx) => tx.update(schema.inboundMessages).set({ readAt: new Date() }).where(or(...ids.map((id) => eq(schema.inboundMessages.id, id)))));
}

/** A text typed at the desk (the inbox or the client page), with an optional picture. Goes through the same queue as every other text. */
export async function sendStaffText(business: typeof schema.businesses.$inferSelect, clientId: string, body: string, media: Media = []) {
  const client = await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) }));
  const phone = normalizePhone(client?.phone);
  if (!client || !phone) throw new Error("This client has no mobile number.");
  if (!client.smsOptIn) throw new Error("This client has opted out of texts.");
  if (await withTenant(business.id, (tx) => isSmsSuppressed(tx, phone))) throw new Error("This number replied STOP, so nothing can be sent to it.");
  const text = body.trim().slice(0, 1000);
  if (!text && !media.length) throw new Error("Type a message or attach a picture.");
  await queueOneOff(business.id, { channel: "sms", template: "staff_reply", recipient: phone, body: text, clientId: client.id, media });
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
  /** The latest text was the desk's and did not go out (undelivered, or stopped before sending). */
  lastFailed: boolean;
  unread: number;
  /** The client's next booked visit, when there is one. */
  nextAt: Date | null;
};

type InRow = { k: string; client_id: string | null; from_number: string; body: string; media: Media; received_at: Date | string; unread: number | string };
type OutRow = { client_id: string; recipient: string; body: string; at: Date | string; status: string };
const asDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));

/**
 * One row per person the business has texted with: unread conversations first, then
 * newest first (grouped in the database, so there is no cap on how far back it reaches).
 * `q` filters by name, number or last message, `filter` narrows to unread / needs reply /
 * opted out, and `limit` pages the result. `unread` in the result counts every unread
 * text, whatever the filter.
 */
export async function listConversations(businessId: string, opts: { q?: string; limit?: number; filter?: ConversationFilter } = {}): Promise<{ items: Conversation[]; total: number; unread: number }> {
  const limit = opts.limit ?? 50;
  return withTenant(businessId, async (tx) => {
    const inbound = (await tx.execute(sql`
      select distinct on (k) k, client_id, from_number, body, media, received_at,
        count(*) filter (where read_at is null) over (partition by k) as unread
      from (select *, coalesce(client_id, 'tel:' || from_number) as k from inbound_messages) m
      order by k, received_at desc`)) as unknown as InRow[];
    const outbound = (await tx.execute(sql`
      select distinct on (client_id) client_id, recipient, body, coalesce(sent_at, scheduled_at) as at,
        case when status = 'sent' and delivery_status = 'delivered' then 'delivered' else status::text end as status
      from notifications
      where channel = 'sms' and client_id is not null and status in ('sent','sending','queued','failed','skipped')
        and (template = 'staff_reply' or client_id in (select client_id from inbound_messages where client_id is not null))
      order by client_id, coalesce(sent_at, scheduled_at) desc`)) as unknown as OutRow[];
    const byKey = new Map<string, Conversation>();
    for (const m of inbound) {
      byKey.set(m.k, { key: m.k, clientId: m.client_id, name: m.from_number, phone: m.from_number, smsOptIn: true, lastBody: m.body || (m.media?.length ? "Picture" : ""), lastAt: asDate(m.received_at), lastDir: "in", lastFailed: false, unread: Number(m.unread), nextAt: null });
    }
    for (const o of outbound) {
      const at = asDate(o.at);
      const cur = byKey.get(o.client_id);
      if (!cur) byKey.set(o.client_id, { key: o.client_id, clientId: o.client_id, name: o.recipient, phone: o.recipient, smsOptIn: true, lastBody: o.body, lastAt: at, lastDir: "out", lastFailed: o.status === "failed" || o.status === "skipped", unread: 0, nextAt: null });
      else if (at > cur.lastAt) Object.assign(cur, { lastBody: o.body, lastAt: at, lastDir: "out", lastFailed: o.status === "failed" || o.status === "skipped" });
    }
    const ids = [...byKey.values()].flatMap((c) => (c.clientId ? [c.clientId] : []));
    if (ids.length) {
      const people = await tx.select({ id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName, phone: schema.clients.phone, smsOptIn: schema.clients.smsOptIn }).from(schema.clients).where(inArray(schema.clients.id, ids));
      for (const p of people) {
        const c = byKey.get(p.id);
        if (c) Object.assign(c, { name: `${p.firstName} ${p.lastName}`.trim() || c.name, phone: p.phone ?? c.phone, smsOptIn: p.smsOptIn });
      }
      // Each person's next booked visit, so the list says who is coming in without opening them.
      const nexts = await tx
        .select({ clientId: schema.appointments.clientId, at: sql<Date>`min(${schema.appointmentItems.startAt})` })
        .from(schema.appointmentItems)
        .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
        .where(and(inArray(schema.appointments.clientId, ids), eq(schema.appointments.kind, "visit"), eq(schema.appointmentItems.sortOrder, 0), inArray(schema.appointments.status, ["booked", "confirmed"]), gte(schema.appointmentItems.startAt, new Date())))
        .groupBy(schema.appointments.clientId);
      for (const n of nexts) {
        const c = n.clientId ? byKey.get(n.clientId) : undefined;
        if (c) c.nextAt = asDate(n.at);
      }
    }
    const q = opts.q?.trim().toLowerCase();
    const qDigits = q?.replace(/\D/g, "");
    const everyone = [...byKey.values()];
    const unread = everyone.reduce((n, c) => n + c.unread, 0);
    const all = sortConversations(
      filterConversations(everyone, opts.filter ?? "all").filter((c) => !q || c.name.toLowerCase().includes(q) || c.lastBody.toLowerCase().includes(q) || (!!qDigits && qDigits.length >= 3 && c.phone.replace(/\D/g, "").includes(qDigits))),
    );
    return { items: all.slice(0, limit), total: all.length, unread };
  });
}

/** Texts from one sender who is not a client: the thread for a `tel:` key. */
export async function numberThread(businessId: string, number: string, limit = 50): Promise<ThreadItem[]> {
  return withTenant(businessId, async (tx) => {
    const rows = await tx.select().from(schema.inboundMessages).where(and(isNull(schema.inboundMessages.clientId), eq(schema.inboundMessages.fromNumber, number))).orderBy(desc(schema.inboundMessages.receivedAt)).limit(limit);
    return rows.map((m) => ({ id: m.id, dir: "in" as const, body: m.body, at: m.receivedAt, status: "received", deliveryStatus: null, error: null, template: null, media: m.media ?? [] })).reverse();
  });
}

/**
 * Turn a number that texted in into a client (or, when a client already has that number, attach its texts to them),
 * and move its earlier texts onto that client. Returns the client id.
 */
export async function addNumberAsClient(businessId: string, number: string, name: { firstName: string; lastName?: string }): Promise<string> {
  return withTenant(businessId, async (tx) => {
    const phone = normalizePhone(number) ?? number;
    let client = await clientByPhone(tx, phone);
    if (!client) {
      // Texting in is not consent to marketing; a number that sent STOP stays off texts.
      const [created] = await tx.insert(schema.clients).values({ businessId, firstName: name.firstName.trim() || "New", lastName: (name.lastName ?? "").trim(), phone, tags: ["texted-in"], smsOptIn: !(await isSmsSuppressed(tx, phone)) }).returning();
      client = created!;
    }
    await tx.update(schema.inboundMessages).set({ clientId: client.id }).where(and(isNull(schema.inboundMessages.clientId), eq(schema.inboundMessages.fromNumber, number)));
    return client.id;
  });
}

const unreadWhere = (key: string) => (key.startsWith("tel:") ? and(isNull(schema.inboundMessages.clientId), eq(schema.inboundMessages.fromNumber, key.slice(4))) : eq(schema.inboundMessages.clientId, key));

/** Mark everything a client (or an unknown number) has sent as read. */
export async function markConversationRead(businessId: string, key: string) {
  await withTenant(businessId, (tx) => tx.update(schema.inboundMessages).set({ readAt: new Date() }).where(and(isNull(schema.inboundMessages.readAt), unreadWhere(key))));
}

/** Put a conversation back in the unread pile: its latest text is unread again. Returns false when nothing was ever received from them. */
export async function markConversationUnread(businessId: string, key: string): Promise<boolean> {
  return withTenant(businessId, async (tx) => {
    const latest = await tx.select({ id: schema.inboundMessages.id }).from(schema.inboundMessages).where(unreadWhere(key)).orderBy(desc(schema.inboundMessages.receivedAt)).limit(1);
    if (!latest.length) return false;
    await tx.update(schema.inboundMessages).set({ readAt: null }).where(eq(schema.inboundMessages.id, latest[0]!.id));
    return true;
  });
}

/** Unread texts in one conversation (a client id or a `tel:` key). */
export async function unreadFor(businessId: string, key: string) {
  const [r] = await withTenant(businessId, (tx) => tx.select({ n: sql<number>`count(*)` }).from(schema.inboundMessages).where(and(isNull(schema.inboundMessages.readAt), unreadWhere(key))));
  return Number(r?.n ?? 0);
}
