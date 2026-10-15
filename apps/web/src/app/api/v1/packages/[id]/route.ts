import { readBody, route, PRICE_FIELDS } from "@/lib/api";
import { getPackageApi, packagePatch, patchPackageApi } from "@/server/api-v1-catalog";

export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => getPackageApi(ctx.business.id, id));

/** PATCH /api/v1/packages/:id: send only what changes. {"active": false} hides it from sale; true shows it again. */
export const PATCH = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const body = await readBody(req, packagePatch);
  if ("error" in body) return body.error;
  return patchPackageApi(ctx, id, body.data);
}, { fields: PRICE_FIELDS });
