import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { listLocationsApi, serializeLocation } from "@/server/api-v1-more";

export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => {
  const l = (await listLocationsApi(ctx.business.id)).find((x) => x.id === id);
  return l ? NextResponse.json({ data: serializeLocation(l) }) : ApiErrors.notFound("location");
});
