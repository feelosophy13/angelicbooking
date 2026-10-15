import { NextResponse } from "next/server";
import { withTenant } from "@angelic/db";
import { deleteWorkflow, setWorkflowEnabled, updateWorkflow, WorkflowError, type WorkflowInput } from "@/server/workflows";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { filtersForeign, getWorkflowApi, serializeWorkflow, toFilters, toSteps, workflowPatch } from "@/server/api-v1-marketing";

export const GET = route<{ id: string }>("marketing:read", async (ctx, _req, { id }) => {
  const w = await getWorkflowApi(ctx.business.id, id);
  return w ? NextResponse.json({ data: serializeWorkflow(w) }) : ApiErrors.notFound("automation");
});

/**
 * PATCH /api/v1/automations/:id: change any of name, description, trigger, enabled, exit_on_booking, filters, steps.
 * `filters` and `steps`, when given, replace the whole thing. Sending only `enabled` is the app's on/off switch (turning off also
 * cancels runs in flight); the app's full save does not cancel them.
 */
export const PATCH = route<{ id: string }>("marketing:write", async (ctx, req, { id }) => {
  const body = await readBody(req, workflowPatch);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const current = await getWorkflowApi(b, id);
  if (!current) return ApiErrors.notFound("automation");
  const keys = Object.keys(d);
  if (!keys.length) return NextResponse.json({ data: serializeWorkflow(current) });
  const input: WorkflowInput = {
    name: d.name ?? current.name,
    description: d.description !== undefined ? d.description || null : current.description,
    trigger: d.trigger ?? current.trigger,
    enabled: d.enabled ?? current.enabled,
    exitOnBooking: d.exit_on_booking ?? current.exitOnBooking,
    filters: d.filters !== undefined ? toFilters(d.filters) : current.filters,
    steps: d.steps !== undefined ? toSteps(d.steps) : current.steps,
  };
  if (d.filters !== undefined) {
    const miss = await withTenant(b, (tx) => filtersForeign(tx, b, input.filters));
    if (miss) return ApiErrors.notFound(miss);
  }
  try {
    if (keys.length === 1 && keys[0] === "enabled") await setWorkflowEnabled(b, id, input.enabled);
    else await updateWorkflow(b, id, input);
  } catch (e) {
    if (e instanceof WorkflowError) return ApiErrors.invalid(e.message);
    throw e;
  }
  await apiAudit(ctx, "api.automation.update", "workflow", id, { fields: keys });
  return NextResponse.json({ data: serializeWorkflow((await getWorkflowApi(b, id))!) });
});

/** DELETE /api/v1/automations/:id: delete a custom automation. The built-in ones can only be turned off (409). */
export const DELETE = route<{ id: string }>("marketing:write", async (ctx, _req, { id }) => {
  const b = ctx.business.id;
  if (!(await getWorkflowApi(b, id))) return ApiErrors.notFound("automation");
  try {
    await deleteWorkflow(b, id);
  } catch (e) {
    if (e instanceof WorkflowError) return ApiErrors.conflict(e.message);
    throw e;
  }
  await apiAudit(ctx, "api.automation.delete", "workflow", id);
  return NextResponse.json({ data: { id, deleted: true } });
});
