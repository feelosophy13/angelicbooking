import { readBody, route } from "@/lib/api";
import { getPlanApi, patchPlanApi, planPatch } from "@/server/api-v1-catalog";

export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => getPlanApi(ctx.business.id, id));

/**
 * PATCH /api/v1/membership-plans/:id: send only what changes. Sessions need a service; the cadence must be billable (422 otherwise).
 * A new price or cadence clears the stored Stripe price, as in the app. {"active": false} hides the plan.
 */
export const PATCH = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const body = await readBody(req, planPatch);
  if ("error" in body) return body.error;
  return patchPlanApi(ctx, id, body.data);
});
