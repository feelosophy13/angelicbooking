import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { getStaff, serializeStaff } from "@/server/api-v1";
import { patchStaffApi } from "@/server/api-v1-team";

export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => {
  const s = await getStaff(ctx.business.id, id);
  return s ? NextResponse.json({ data: serializeStaff(s) }) : ApiErrors.notFound("staff member");
});

/** PATCH /api/v1/staff/:id: profile fields, active or inactive, whether they take appointments or show online, primary location, sort order. */
export const PATCH = route<{ id: string }>("staff:write", (ctx, req, { id }) => patchStaffApi(ctx, req, id));
