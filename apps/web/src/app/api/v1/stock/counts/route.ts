import { readBody, route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { countBody, countStockApi } from "@/server/api-v1-inventory";

/** POST /api/v1/stock/counts: { location_id, note?, counts: [{ product_id, counted }] }. Products you leave out are not touched. */
export const POST = route("inventory:write", async (ctx, req) => {
  const body = await readBody(req, countBody);
  if ("error" in body) return body.error;
  return guarded(() => countStockApi(ctx, body.data));
});
