import { list, pageParams, route } from "@/lib/api";
import { listPlansApi, serializePlan } from "@/server/api-v1-more";

/** GET /api/v1/membership-plans: the membership plans you sell. */
export const GET = route("catalog:read", async (ctx, req) => {
  const p = pageParams(new URL(req.url));
  return list((await listPlansApi(ctx.business.id, p)).map(serializePlan), p);
});
