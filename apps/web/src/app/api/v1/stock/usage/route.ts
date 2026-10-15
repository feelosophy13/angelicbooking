import { readBody, route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { logUsageApi, usageBody } from "@/server/api-v1-inventory";

/** POST /api/v1/stock/usage: log supplies used up, not tied to a visit. { location_id?, note?, items: [{ product_id, quantity }] }. May take a count below zero. */
export const POST = route("inventory:write", async (ctx, req) => {
  const body = await readBody(req, usageBody);
  if ("error" in body) return body.error;
  return guarded(() => logUsageApi(ctx, body.data, null));
});
