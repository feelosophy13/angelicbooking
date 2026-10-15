import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { getSessionApi } from "@/server/api-v1-appointments";

/** GET /api/v1/classes/:id: one session with its roster (who holds a seat and the status of their booking; no contact details). */
export const GET = route<{ id: string }>("appointments:read", async (ctx, _req, { id }) => {
  const s = await getSessionApi(ctx.business.id, id);
  return s ? NextResponse.json({ data: s }) : ApiErrors.notFound("class");
});
