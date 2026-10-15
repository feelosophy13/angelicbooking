import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { serializeSubmission } from "@/server/api-v1-forms";
import { getSubmission } from "@/server/forms";

/** GET /api/v1/form-submissions/:id: one submission with each question, its label and the answer. Uploaded files and the drawn signature are not returned. */
export const GET = route<{ id: string }>("forms:read", async (ctx, _req, { id }) => {
  const row = await getSubmission(ctx.business.id, id);
  if (!row || row.s.businessId !== ctx.business.id) return ApiErrors.notFound("submission");
  return NextResponse.json({ data: serializeSubmission(row) });
});
