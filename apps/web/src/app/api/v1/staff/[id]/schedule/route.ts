import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { staffScheduleApi } from "@/server/api-v1-more";

/** GET /api/v1/staff/:id/schedule: weekly hours (24h local time), upcoming days off or changed hours, and the services they perform with any own price or length. */
export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => {
  const s = await staffScheduleApi(ctx.business.id, id);
  return s ? NextResponse.json({ data: s }) : ApiErrors.notFound("staff member");
});
