import { NextResponse } from "next/server";
import { apiAudit, ApiErrors, route } from "@/lib/api";
import { findFormApi, serializeForm } from "@/server/api-v1-forms";
import { duplicateForm } from "@/server/forms";

/** POST /api/v1/forms/:id/duplicate: a copy named "Copy of ...", inactive until you turn it on. */
export const POST = route<{ id: string }>("forms:write", async (ctx, _req, { id }) => {
  const b = ctx.business.id;
  if (!(await findFormApi(b, id))) return ApiErrors.notFound("form");
  const copyId = await duplicateForm(b, id);
  if (!copyId) return ApiErrors.notFound("form");
  await apiAudit(ctx, "api.form.duplicate", "form", copyId, { from: id });
  return NextResponse.json({ data: serializeForm((await findFormApi(b, copyId))!) }, { status: 201 });
});
