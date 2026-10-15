import { readBody, route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { deleteLineApi, linePatch, patchLineApi } from "@/server/api-v1-inventory";

/** PATCH /api/v1/purchase-orders/:id/lines/:productId: { quantity?, unit_cost_cents? } on a line that is already on the order. */
export const PATCH = route<{ id: string; productId: string }>("inventory:write", async (ctx, req, { id, productId }) => {
  const body = await readBody(req, linePatch);
  if ("error" in body) return body.error;
  return guarded(() => patchLineApi(ctx, id, productId, body.data));
});

/** DELETE /api/v1/purchase-orders/:id/lines/:productId: remove a line (409 once some of it has arrived). */
export const DELETE = route<{ id: string; productId: string }>("inventory:write", async (ctx, _req, { id, productId }) => guarded(() => deleteLineApi(ctx, id, productId)));
