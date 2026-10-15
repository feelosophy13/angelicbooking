import { readBody, route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { getOrderApi, orderPatch, patchOrderApi } from "@/server/api-v1-inventory";

/** GET /api/v1/purchase-orders/:id: the order with its lines and what has been received against it. */
export const GET = route<{ id: string }>("inventory:read", async (ctx, _req, { id }) => getOrderApi(ctx.business.id, id));

/** PATCH /api/v1/purchase-orders/:id: supplier, location, expected_on, reference, notes. Only while the order is open (409 once received or cancelled). */
export const PATCH = route<{ id: string }>("inventory:write", async (ctx, req, { id }) => {
  const body = await readBody(req, orderPatch);
  if ("error" in body) return body.error;
  return guarded(() => patchOrderApi(ctx, id, body.data));
});
