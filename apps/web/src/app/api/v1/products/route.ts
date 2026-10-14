import { list, pageParams, route } from "@/lib/api";
import { listProducts, serializeProduct } from "@/server/api-v1";

/** GET /api/v1/products: active products. Cost, supplier and reorder settings are not exposed. */
export const GET = route("catalog:read", async (ctx, req) => {
  const p = pageParams(new URL(req.url));
  const rows = await listProducts(ctx.business.id, { limit: p.limit, offset: p.offset });
  return list(rows.map(serializeProduct), p);
});
