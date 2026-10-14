import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { getService } from "@/server/api-v1";
import { getPublicSlots } from "@/server/public-booking";

/** GET /api/v1/availability?service_id=&date=YYYY-MM-DD&staff_id=any|<id>: the open start times, as online booking would offer them. */
export const GET = route("catalog:read", async (ctx, req) => {
  const q = new URL(req.url).searchParams;
  const serviceId = q.get("service_id") ?? "";
  const date = q.get("date") ?? "";
  const staffId = q.get("staff_id") || "any";
  if (!serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return ApiErrors.invalid("service_id and date (YYYY-MM-DD) are required.");
  if (!(await getService(ctx.business.id, serviceId))) return ApiErrors.notFound("service");
  const slots = await getPublicSlots(ctx.business, serviceId, staffId, date);
  return NextResponse.json({ data: slots.map((s) => ({ start_at: s.at.toISOString(), staff_id: s.staffId, staff_name: s.staffName })) });
});
