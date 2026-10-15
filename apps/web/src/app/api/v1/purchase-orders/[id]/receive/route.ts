import { readBody, route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { receiveOrderApi, receiveOrderBody } from "@/server/api-v1-inventory";

/** POST /api/v1/purchase-orders/:id/receive: { reference?, lines: [{ line_id, quantity, unit_cost_cents? }] }. Adds the stock; the order completes when everything has arrived. */
export const POST = route<{ id: string }>("inventory:write", async (ctx, req, { id }) => {
  const body = await readBody(req, receiveOrderBody);
  if ("error" in body) return body.error;
  return guarded(() => receiveOrderApi(ctx, id, body.data));
});
