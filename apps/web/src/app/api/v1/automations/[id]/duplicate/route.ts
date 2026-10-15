import { NextResponse } from "next/server";
import { duplicateWorkflow, WorkflowError } from "@/server/workflows";
import { apiAudit, ApiErrors, route } from "@/lib/api";
import { getWorkflowApi, serializeWorkflow } from "@/server/api-v1-marketing";

/** POST /api/v1/automations/:id/duplicate: a copy named "... (copy)", switched off. */
export const POST = route<{ id: string }>("marketing:write", async (ctx, _req, { id }) => {
  const b = ctx.business.id;
  if (!(await getWorkflowApi(b, id))) return ApiErrors.notFound("automation");
  let copyId: string;
  try {
    copyId = await duplicateWorkflow(b, id);
  } catch (e) {
    if (e instanceof WorkflowError) return ApiErrors.invalid(e.message);
    throw e;
  }
  await apiAudit(ctx, "api.automation.duplicate", "workflow", copyId, { from: id });
  return NextResponse.json({ data: serializeWorkflow((await getWorkflowApi(b, copyId))!) }, { status: 201 });
});
