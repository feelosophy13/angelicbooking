import { list, pageParams, route } from "@/lib/api";
import { listStaff, serializeStaff } from "@/server/api-v1";

/** GET /api/v1/staff: active team members (public profile fields only). */
export const GET = route("catalog:read", async (ctx, req) => {
  const p = pageParams(new URL(req.url));
  const rows = await listStaff(ctx.business.id, { limit: p.limit, offset: p.offset });
  return list(rows.map(serializeStaff), p);
});
