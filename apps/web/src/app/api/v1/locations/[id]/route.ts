import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { listLocationsApi, serializeLocation } from "@/server/api-v1-more";
import { deleteLocationApi, patchLocationApi } from "@/server/api-v1-settings";

export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => {
  const l = (await listLocationsApi(ctx.business.id)).find((x) => x.id === id);
  return l ? NextResponse.json({ data: serializeLocation(l) }) : ApiErrors.notFound("location");
});

export const PATCH = route<{ id: string }>("settings:write", (ctx, req, { id }) => patchLocationApi(ctx, req, id));
export const DELETE = route<{ id: string }>("settings:write", (ctx, _req, { id }) => deleteLocationApi(ctx, id));
