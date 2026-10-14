import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { clientExists, clientHoldingsApi } from "@/server/api-v1-more";

/** GET /api/v1/clients/:id/packages: what this client currently holds. */
export const GET = route<{ id: string }>("clients:read", async (ctx, _req, { id }) => {
  if (!(await clientExists(ctx.business.id, id))) return ApiErrors.notFound("client");
  return NextResponse.json({ data: (await clientHoldingsApi(ctx.business.id, id)).packages });
});
