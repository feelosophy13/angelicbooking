import { list, pageParams, probe, readBody, route } from "@/lib/api";
import { listProducts, serializeProduct } from "@/server/api-v1";
import { createProductApi, productCreateX } from "@/server/api-v1-catalog";

/** GET /api/v1/products: active products. Cost, supplier and reorder settings are not exposed (see /inventory for those). */
export const GET = route("catalog:read", async (ctx, req) => {
  const p = pageParams(new URL(req.url));
  const rows = await listProducts(ctx.business.id, probe(p));
  return list(rows.map(serializeProduct), p);
});

/** POST /api/v1/products. A barcode or SKU can belong to one product only (409 otherwise). Products that come in options use /product-groups. */
export const POST = route("catalog:write", async (ctx, req) => {
  const body = await readBody(req, productCreateX);
  if ("error" in body) return body.error;
  return createProductApi(ctx, body.data);
});
