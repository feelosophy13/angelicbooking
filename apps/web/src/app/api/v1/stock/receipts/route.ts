import { readBody, route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { receiveBody, receiveStockApi } from "@/server/api-v1-inventory";

/** POST /api/v1/stock/receipts: a delivery with no purchase order. { location_id?, note?, items: [{ product_id, quantity }] }, one product or many. */
export const POST = route("inventory:write", async (ctx, req) => {
  const body = await readBody(req, receiveBody);
  if ("error" in body) return body.error;
  return guarded(() => receiveStockApi(ctx, body.data));
});
