import { readBody, route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { addLineApi, lineAdd } from "@/server/api-v1-inventory";

/** POST /api/v1/purchase-orders/:id/lines: { product_id, quantity, unit_cost_cents? }. Adds the product, or replaces its quantity if it is already on the order. */
export const POST = route<{ id: string }>("inventory:write", async (ctx, req, { id }) => {
  const body = await readBody(req, lineAdd);
  if ("error" in body) return body.error;
  return guarded(() => addLineApi(ctx, id, body.data));
});
