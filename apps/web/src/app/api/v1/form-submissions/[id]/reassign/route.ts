import { NextResponse } from "next/server";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, firstForeign, readBody, route } from "@/lib/api";
import { findSubmissionApi, reassignBody, serializeSubmission } from "@/server/api-v1-forms";
import { getSubmission, reassignSubmission } from "@/server/forms";

/** POST /api/v1/form-submissions/:id/reassign {client_id}: move a submission filed under the wrong person to the right client (it is detached from any visit). */
export const POST = route<{ id: string }>("forms:void", async (ctx, req, { id }) => {
  const body = await readBody(req, reassignBody);
  if ("error" in body) return body.error;
  const b = ctx.business.id;
  if (!(await findSubmissionApi(b, id))) return ApiErrors.notFound("submission");
  if (await withTenant(b, (tx) => firstForeign(tx, b, [[schema.clients, body.data.client_id, "client"]]))) return ApiErrors.notFound("client");
  await reassignSubmission(b, id, body.data.client_id, ctx.actor);
  await apiAudit(ctx, "api.form.reassign", "form_submission", id, { to: body.data.client_id });
  return NextResponse.json({ data: serializeSubmission((await getSubmission(b, id))!) });
});
