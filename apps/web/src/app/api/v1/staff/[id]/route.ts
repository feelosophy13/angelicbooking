import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { getStaff, serializeStaff } from "@/server/api-v1";

export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => {
  const s = await getStaff(ctx.business.id, id);
  return s ? NextResponse.json({ data: serializeStaff(s) }) : ApiErrors.notFound("staff member");
});
