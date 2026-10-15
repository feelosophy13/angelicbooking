import { readBody, route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { transferBody, transferStockApi } from "@/server/api-v1-inventory";

/** POST /api/v1/stock/transfers: { product_id, from_location_id, to_location_id, quantity, note? }. The source cannot go below zero (409). */
export const POST = route("inventory:write", async (ctx, req) => {
  const body = await readBody(req, transferBody);
  if ("error" in body) return body.error;
  return guarded(() => transferStockApi(ctx, body.data));
});
