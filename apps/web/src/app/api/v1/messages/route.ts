import { list, pageParams, route } from "@/lib/api";
import { listInboundApi, serializeInbound } from "@/server/api-v1-messages";

/** GET /api/v1/messages?client_id=&unread=true: texts clients sent to the business's number, newest first. */
export const GET = route("messages:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const rows = await listInboundApi(ctx.business.id, p, { clientId: url.searchParams.get("client_id") || undefined, unread: url.searchParams.get("unread") === "true" });
  return list(rows.map((r) => serializeInbound(r.m, r)), p);
});
