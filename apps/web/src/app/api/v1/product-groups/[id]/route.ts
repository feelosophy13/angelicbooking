import { readBody, route, PRICE_FIELDS } from "@/lib/api";
import { getGroupApi, groupPatch, guarded, patchGroupApi } from "@/server/api-v1-catalog";

export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => getGroupApi(ctx.business.id, id));

/** PATCH /api/v1/product-groups/:id: what the options share (every option follows). {"active": false} hides the product with all its options. */
export const PATCH = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const body = await readBody(req, groupPatch);
  if ("error" in body) return body.error;
  return guarded(() => patchGroupApi(ctx, id, body.data));
}, { fields: PRICE_FIELDS });
