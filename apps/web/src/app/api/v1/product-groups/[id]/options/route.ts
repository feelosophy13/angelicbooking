import { readBody, route, PRICE_FIELDS } from "@/lib/api";
import { addGroupOptionsApi, groupOptionsBody, guarded } from "@/server/api-v1-catalog";

/** POST /api/v1/product-groups/:id/options: { options: [...], price_cents?, cost_cents? }. Labels the group already has are skipped (409 when none is new). */
export const POST = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const body = await readBody(req, groupOptionsBody);
  if ("error" in body) return body.error;
  return guarded(() => addGroupOptionsApi(ctx, id, body.data));
}, { fields: PRICE_FIELDS });
