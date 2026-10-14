import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { listLocationsApi, serializeLocation } from "@/server/api-v1-more";

/** GET /api/v1/locations: addresses, hours and phone. Payment accounts and tokens are not included. */
export const GET = route("catalog:read", async (ctx) => NextResponse.json({ data: (await listLocationsApi(ctx.business.id)).map(serializeLocation) }));
