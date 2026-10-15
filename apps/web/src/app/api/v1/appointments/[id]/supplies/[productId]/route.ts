import { ApiErrors, route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { undoVisitSuppliesApi } from "@/server/api-v1-inventory";

/** DELETE /api/v1/appointments/:id/supplies/:productId?quantity=N: take back supplies logged by mistake (default: everything logged for that product). */
export const DELETE = route<{ id: string; productId: string }>("inventory:write", async (ctx, req, { id, productId }) => {
  const raw = new URL(req.url).searchParams.get("quantity");
  const quantity = raw === null ? null : Number(raw);
  if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000)) return ApiErrors.invalid("quantity must be a whole number of units.");
  return guarded(() => undoVisitSuppliesApi(ctx, id, productId, quantity));
});
