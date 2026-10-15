import { ApiErrors, list, pageParams, route } from "@/lib/api";
import { getWorkflowApi, listRunsApi, serializeRun } from "@/server/api-v1-marketing";

/** GET /api/v1/automations/:id/runs: who went through this automation, newest first, with each run's step log. */
export const GET = route<{ id: string }>("marketing:read", async (ctx, req, { id }) => {
  if (!(await getWorkflowApi(ctx.business.id, id))) return ApiErrors.notFound("automation");
  const p = pageParams(new URL(req.url));
  return list((await listRunsApi(ctx.business.id, id, p)).map(serializeRun), p);
});
