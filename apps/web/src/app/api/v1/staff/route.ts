import { list, pageParams, route } from "@/lib/api";
import { listStaff, serializeStaff } from "@/server/api-v1";
import { createStaffApi } from "@/server/api-v1-team";

/** GET /api/v1/staff: active team members (public profile fields only). */
export const GET = route("catalog:read", async (ctx, req) => {
  const p = pageParams(new URL(req.url));
  const rows = await listStaff(ctx.business.id, { limit: p.limit, offset: p.offset });
  return list(rows.map(serializeStaff), p);
});

/** POST /api/v1/staff: add a team member (starts with Tue-Sat 9 to 5, like the app). */
export const POST = route("staff:write", (ctx, req) => createStaffApi(ctx, req));
