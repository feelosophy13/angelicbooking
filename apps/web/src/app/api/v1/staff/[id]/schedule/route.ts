import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { staffScheduleApi } from "@/server/api-v1-more";
import { putScheduleApi } from "@/server/api-v1-team";

/**
 * GET /api/v1/staff/:id/schedule: weekly hours (24h local time), upcoming days off or changed hours, and the services they perform with any
 * own price or length. A person's hours are team data (S5 in PERMISSIONS-PLAN-2026-10-18.md), so this reads with staff:read (it was catalog:read).
 */
export const GET = route<{ id: string }>("staff:read", async (ctx, _req, { id }) => {
  const s = await staffScheduleApi(ctx.business.id, id);
  return s ? NextResponse.json({ data: s }) : ApiErrors.notFound("staff member");
});

/** PUT /api/v1/staff/:id/schedule: replace the weekly hours (and rotation). */
export const PUT = route<{ id: string }>("staff:write", (ctx, req, { id }) => putScheduleApi(ctx, req, id));
