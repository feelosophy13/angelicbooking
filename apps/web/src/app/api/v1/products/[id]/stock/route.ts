import { route } from "@/lib/api";
import { stockApi } from "@/server/api-v1-inventory";

/** GET /api/v1/products/:id/stock: what is on hand in total and at each location. */
export const GET = route<{ id: string }>("inventory:read", async (ctx, _req, { id }) => stockApi(ctx.business.id, id));
