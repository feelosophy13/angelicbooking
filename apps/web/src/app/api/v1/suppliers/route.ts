import { pageParams, readBody, route } from "@/lib/api";
import { createSupplierApi, listSuppliersApi, supplierCreate } from "@/server/api-v1-inventory";

/** GET /api/v1/suppliers?include_inactive=1 */
export const GET = route("purchasing:read", async (ctx, req) => {
  const url = new URL(req.url);
  return listSuppliersApi(ctx.business.id, pageParams(url), url.searchParams.get("include_inactive") === "1");
});

/** POST /api/v1/suppliers: { name, contact_name?, email?, phone?, account_number?, notes? }. */
export const POST = route("purchasing:write", async (ctx, req) => {
  const body = await readBody(req, supplierCreate);
  if ("error" in body) return body.error;
  return createSupplierApi(ctx, body.data);
});
