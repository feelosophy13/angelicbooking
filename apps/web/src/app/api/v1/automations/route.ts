import { NextResponse } from "next/server";
import { withTenant } from "@angelic/db";
import { createWorkflow, listWorkflows, WorkflowError, type WorkflowInput } from "@/server/workflows";
import { apiAudit, ApiErrors, list, pageParams, readBody, route } from "@/lib/api";
import { filtersForeign, getWorkflowApi, serializeWorkflow, toFilters, toSteps, WORKFLOW_DEFAULTS, workflowCreate } from "@/server/api-v1-marketing";

/** GET /api/v1/automations: every automation (workflow), including the built-in ones, with how many messages each sent in the last 30 days. */
export const GET = route("marketing:read", async (ctx, req) => {
  const p = pageParams(new URL(req.url));
  const all = await listWorkflows(ctx.business);
  return list(all.slice(p.offset, p.offset + p.limit).map(serializeWorkflow), p, all.length);
});

/** POST /api/v1/automations: create an automation. It starts off unless `enabled: true`. */
export const POST = route("marketing:write", async (ctx, req) => {
  const body = await readBody(req, workflowCreate);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const input: WorkflowInput = {
    name: d.name, description: d.description ?? WORKFLOW_DEFAULTS.description, trigger: d.trigger, enabled: d.enabled ?? WORKFLOW_DEFAULTS.enabled,
    exitOnBooking: d.exit_on_booking ?? WORKFLOW_DEFAULTS.exit_on_booking, filters: toFilters(d.filters), steps: toSteps(d.steps),
  };
  const miss = await withTenant(b, (tx) => filtersForeign(tx, b, input.filters));
  if (miss) return ApiErrors.notFound(miss);
  let id: string;
  try {
    id = await createWorkflow(b, input);
  } catch (e) {
    if (e instanceof WorkflowError) return ApiErrors.invalid(e.message);
    throw e;
  }
  await apiAudit(ctx, "api.automation.create", "workflow", id, { name: input.name, trigger: input.trigger });
  return NextResponse.json({ data: serializeWorkflow((await getWorkflowApi(b, id))!) }, { status: 201 });
});
