import { list, pageParams, route } from "@/lib/api";
import { listNotificationsApi, NOTIFICATION_STATUSES, serializeNotification, type NotificationFilter } from "@/server/api-v1-messages";

const date = (v: string | null) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
};

/** GET /api/v1/notifications: the delivery log of texts and emails sent to clients, newest first. Filters: channel, status, client_id, campaign_id, template, from, to (ISO times, on the created time). */
export const GET = route("messages:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const q = (k: string) => url.searchParams.get(k) || undefined;
  const channel = q("channel");
  const status = q("status");
  const f: NotificationFilter = {
    channel: channel === "email" || channel === "sms" ? channel : undefined,
    status: NOTIFICATION_STATUSES.find((s) => s === status),
    clientId: q("client_id"), campaignId: q("campaign_id"), template: q("template"), from: date(q("from") ?? null), to: date(q("to") ?? null),
  };
  return list((await listNotificationsApi(ctx.business.id, p, f)).map(serializeNotification), p);
});
