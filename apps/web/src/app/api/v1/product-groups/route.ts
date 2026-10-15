import { list, pageParams, probe, readBody, route } from "@/lib/api";
import { createGroupApi, groupCreate, guarded, listGroupsApi } from "@/server/api-v1-catalog";

/** GET /api/v1/product-groups?include_inactive=1: products that come in options (sizes, shades), each with its options. */
export const GET = route("catalog:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  return list(await listGroupsApi(ctx.business.id, probe(p), url.searchParams.get("include_inactive") === "1"), p);
});

/** POST /api/v1/product-groups: { name, options: ["50 ml", "100 ml"], price_cents, ... }. Makes the group and one product per option. */
export const POST = route("catalog:write", async (ctx, req) => {
  const body = await readBody(req, groupCreate);
  if ("error" in body) return body.error;
  return guarded(() => createGroupApi(ctx, body.data));
});
