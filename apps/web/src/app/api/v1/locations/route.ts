import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { createLocationApi } from "@/server/api-v1-settings";
import { listLocationsApi, serializeLocation } from "@/server/api-v1-more";

/** GET /api/v1/locations: addresses, hours and phone. Payment accounts and tokens are not included. */
export const GET = route("catalog:read", async (ctx) => NextResponse.json({ data: (await listLocationsApi(ctx.business.id)).map(serializeLocation) }));

/** POST /api/v1/locations: add a location. */
export const POST = route("settings:write", (ctx, req) => createLocationApi(ctx, req));
