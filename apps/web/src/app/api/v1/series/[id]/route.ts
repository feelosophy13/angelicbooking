import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { getSeriesApi } from "@/server/api-v1-appointments";

/** GET /api/v1/series/:id: a standing appointment and every visit booked from it, in date order. */
export const GET = route<{ id: string }>("appointments:read", async (ctx, _req, { id }) => {
  const s = await getSeriesApi(ctx.business.id, id);
  return s ? NextResponse.json({ data: s }) : ApiErrors.notFound("series");
});
