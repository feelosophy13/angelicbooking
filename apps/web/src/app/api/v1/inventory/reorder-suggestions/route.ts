import { route } from "@/lib/api";
import { reorderSuggestionsApi } from "@/server/api-v1-inventory";

/**
 * GET /api/v1/inventory/reorder-suggestions: what to order, grouped by supplier and location. Each location's shortfall is its own order; what is
 * already on its way counts as stock. Turn a group into a draft with POST /purchase-orders.
 */
export const GET = route("inventory:read", async (ctx) => reorderSuggestionsApi(ctx.business.id));
