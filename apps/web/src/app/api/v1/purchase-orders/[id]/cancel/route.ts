import { route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { cancelOrderApi } from "@/server/api-v1-inventory";

/** POST /api/v1/purchase-orders/:id/cancel: cancel an order that is still open (409 otherwise). */
export const POST = route<{ id: string }>("purchasing:write", async (ctx, _req, { id }) => guarded(() => cancelOrderApi(ctx, id)));
