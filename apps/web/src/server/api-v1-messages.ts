import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";

/**
 * Messages API: the delivery log of texts and emails, clients' text replies, and staff replies. Allow-lists again: the log never shows the
 * provider's message id (an internal reference) or the workflow run it came from; bodies are shown (email bodies are the rendered HTML).
 */
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
type Pg = { limit: number; offset: number };

export const serializeNotification = (n: typeof schema.notifications.$inferSelect) => ({
  id: n.id, channel: n.channel, template: n.template, status: n.status, recipient: n.recipient, subject: n.subject, body: n.body, client_id: n.clientId,
  appointment_id: n.appointmentId, campaign_id: n.campaignId, attempts: n.attempts, error: n.error, scheduled_at: iso(n.scheduledAt), sent_at: iso(n.sentAt), created_at: iso(n.createdAt),
});

export const NOTIFICATION_STATUSES = ["queued", "sending", "sent", "failed", "skipped", "cancelled"] as const;

export type NotificationFilter = { channel?: "email" | "sms"; status?: (typeof NOTIFICATION_STATUSES)[number]; clientId?: string; campaignId?: string; template?: string; from?: Date; to?: Date };

export const listNotificationsApi = (b: string, p: Pg, f: NotificationFilter) =>
  withTenant(b, (tx) =>
    tx
      .select()
      .from(schema.notifications)
      .where(and(
        eq(schema.notifications.businessId, b),
        ...(f.channel ? [eq(schema.notifications.channel, f.channel)] : []),
        ...(f.status ? [eq(schema.notifications.status, f.status)] : []),
        ...(f.clientId ? [eq(schema.notifications.clientId, f.clientId)] : []),
        ...(f.campaignId ? [eq(schema.notifications.campaignId, f.campaignId)] : []),
        ...(f.template ? [eq(schema.notifications.template, f.template)] : []),
        ...(f.from ? [gte(schema.notifications.createdAt, f.from)] : []),
        ...(f.to ? [lte(schema.notifications.createdAt, f.to)] : []),
      ))
      .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id))
      .limit(p.limit)
      .offset(p.offset),
  );

export const getNotificationApi = (b: string, id: string) =>
  withTenant(b, (tx) => tx.query.notifications.findFirst({ where: and(eq(schema.notifications.id, id), eq(schema.notifications.businessId, b)) }));

export const serializeInbound = (m: typeof schema.inboundMessages.$inferSelect, client?: { firstName: string | null; lastName: string | null } | null) => ({
  id: m.id, client_id: m.clientId, client_name: client ? `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim() || null : null,
  from_number: m.fromNumber, to_number: m.toNumber, body: m.body, received_at: iso(m.receivedAt), read_at: iso(m.readAt),
});

export const listInboundApi = (b: string, p: Pg, f: { clientId?: string; unread?: boolean }) =>
  withTenant(b, (tx) =>
    tx
      .select({ m: schema.inboundMessages, firstName: schema.clients.firstName, lastName: schema.clients.lastName })
      .from(schema.inboundMessages)
      .leftJoin(schema.clients, eq(schema.clients.id, schema.inboundMessages.clientId))
      .where(and(eq(schema.inboundMessages.businessId, b), ...(f.clientId ? [eq(schema.inboundMessages.clientId, f.clientId)] : []), ...(f.unread ? [isNull(schema.inboundMessages.readAt)] : [])))
      .orderBy(desc(schema.inboundMessages.receivedAt), desc(schema.inboundMessages.id))
      .limit(p.limit)
      .offset(p.offset),
  );

export const replyInput = z.object({ body: z.string().trim().min(1).max(1000) }).strict();
