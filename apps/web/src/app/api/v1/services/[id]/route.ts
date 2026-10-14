import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { getService, serializeService } from "@/server/api-v1";

export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => {
  const s = await getService(ctx.business.id, id);
  return s ? NextResponse.json({ data: serializeService(s) }) : ApiErrors.notFound("service");
});
