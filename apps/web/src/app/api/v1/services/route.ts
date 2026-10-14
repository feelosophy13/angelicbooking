import { list, pageParams, route } from "@/lib/api";
import { listServices, serializeService } from "@/server/api-v1";

/** GET /api/v1/services?include_inactive=1 */
export const GET = route("catalog:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const rows = await listServices(ctx.business.id, { activeOnly: url.searchParams.get("include_inactive") !== "1", limit: p.limit, offset: p.offset });
  return list(rows.map(serializeService), p);
});
