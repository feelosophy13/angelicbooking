import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { getSaleApi } from "@/server/api-v1";

export const GET = route<{ id: string }>("sales:read", async (ctx, _req, { id }) => {
  const s = await getSaleApi(ctx.business.id, id);
  return s ? NextResponse.json({ data: s }) : ApiErrors.notFound("sale");
});
