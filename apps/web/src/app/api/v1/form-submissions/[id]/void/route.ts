import { NextResponse } from "next/server";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { findSubmissionApi, serializeSubmission, voidBody } from "@/server/api-v1-forms";
import { getSubmission, voidSubmission } from "@/server/forms";

/** POST /api/v1/form-submissions/:id/void {reason?}: it stays on file, struck through, and no longer counts as signed. 409 when already void. */
export const POST = route<{ id: string }>("forms:write", async (ctx, req, { id }) => {
  const body = await readBody(req, voidBody);
  if ("error" in body) return body.error;
  const b = ctx.business.id;
  const s = await findSubmissionApi(b, id);
  if (!s) return ApiErrors.notFound("submission");
  if (s.voidedAt) return ApiErrors.conflict("That submission is already void.");
  await voidSubmission(b, id, body.data.reason || null, ctx.actor);
  await apiAudit(ctx, "api.form.void", "form_submission", id, { reason: body.data.reason ?? null });
  return NextResponse.json({ data: serializeSubmission((await getSubmission(b, id))!) });
});
