import { readBody, route } from "@/lib/api";
import { getSupplierApi, patchSupplierApi, supplierPatch } from "@/server/api-v1-inventory";

export const GET = route<{ id: string }>("purchasing:read", async (ctx, _req, { id }) => getSupplierApi(ctx.business.id, id));

/** PATCH /api/v1/suppliers/:id: send only what changes. {"active": false} hides the supplier (suppliers are never deleted: orders point at them). */
export const PATCH = route<{ id: string }>("purchasing:write", async (ctx, req, { id }) => {
  const body = await readBody(req, supplierPatch);
  if ("error" in body) return body.error;
  return patchSupplierApi(ctx, id, body.data);
});
