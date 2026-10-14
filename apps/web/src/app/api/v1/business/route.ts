import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { serializeBusiness } from "@/server/api-v1";

/** GET /api/v1/business: the business this key belongs to. */
export const GET = route("catalog:read", async (ctx) => NextResponse.json({ data: serializeBusiness(ctx.business) }));
