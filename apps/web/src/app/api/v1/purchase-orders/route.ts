import { ApiErrors, pageParams, readBody, route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { createOrderApi, listOrdersApi, orderCreate } from "@/server/api-v1-inventory";

/** GET /api/v1/purchase-orders?status=open|received|all (default open: draft, ordered and partly received; received covers cancelled too). */
export const GET = route("inventory:read", async (ctx, req) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open";
  if (status !== "open" && status !== "received" && status !== "all") return ApiErrors.invalid("status must be open, received or all.");
  return listOrdersApi(ctx.business.id, pageParams(url), status);
});

/** POST /api/v1/purchase-orders: a draft order. { supplier_id?, location_id?, expected_on?, notes?, lines?: [{ product_id, quantity, unit_cost_cents? }] }. */
export const POST = route("inventory:write", async (ctx, req) => {
  const body = await readBody(req, orderCreate);
  if ("error" in body) return body.error;
  return guarded(() => createOrderApi(ctx, body.data));
});
