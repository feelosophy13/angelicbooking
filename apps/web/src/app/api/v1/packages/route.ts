import { list, pageParams, route } from "@/lib/api";
import { listPackagesApi, serializePackage } from "@/server/api-v1-more";

/** GET /api/v1/packages: the prepaid session packages you sell. */
export const GET = route("catalog:read", async (ctx, req) => {
  const p = pageParams(new URL(req.url));
  return list((await listPackagesApi(ctx.business.id, p)).map(serializePackage), p);
});
