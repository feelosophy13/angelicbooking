import { readBody, route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { logVisitSuppliesApi, usageBody, visitSuppliesApi } from "@/server/api-v1-inventory";

/** GET /api/v1/appointments/:id/supplies: what has been logged as used on this visit (net of anything taken back). */
export const GET = route<{ id: string }>("inventory:read", async (ctx, _req, { id }) => visitSuppliesApi(ctx.business.id, id));

/** POST /api/v1/appointments/:id/supplies: { items: [{ product_id, quantity }], note? }. Comes off the visit's location; may take a count below zero. */
export const POST = route<{ id: string }>("inventory:write", async (ctx, req, { id }) => {
  const body = await readBody(req, usageBody);
  if ("error" in body) return body.error;
  return guarded(() => logVisitSuppliesApi(ctx, id, body.data));
});
