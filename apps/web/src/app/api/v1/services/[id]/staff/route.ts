import { readBody, route } from "@/lib/api";
import { getServiceStaffApi, putServiceStaffApi, serviceStaffPut } from "@/server/api-v1-catalog";

/** GET /api/v1/services/:id/staff: who performs the service, with the price and length each charges (their own, or the service's). */
export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => getServiceStaffApi(ctx.business.id, id));

/** PUT /api/v1/services/:id/staff: replace the set of people who perform it. Omit a price or length to keep what is stored; null uses the service's own. */
export const PUT = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const body = await readBody(req, serviceStaffPut);
  if ("error" in body) return body.error;
  return putServiceStaffApi(ctx, id, body.data);
});
