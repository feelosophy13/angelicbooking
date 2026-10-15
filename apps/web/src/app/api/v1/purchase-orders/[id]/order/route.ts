import { route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { markOrderedApi } from "@/server/api-v1-inventory";

/** POST /api/v1/purchase-orders/:id/order: mark a draft as ordered (it needs at least one line). This records that you ordered; it does not contact the supplier. */
export const POST = route<{ id: string }>("inventory:write", async (ctx, _req, { id }) => guarded(() => markOrderedApi(ctx, id)));
