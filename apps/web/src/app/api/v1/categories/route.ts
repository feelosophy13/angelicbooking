import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { listCategoriesApi } from "@/server/api-v1-more";

/** GET /api/v1/categories?kind=service|product (default service). Service categories nest through parent_id. */
export const GET = route("catalog:read", async (ctx, req) => {
  const kind = new URL(req.url).searchParams.get("kind") ?? "service";
  if (kind !== "service" && kind !== "product") return ApiErrors.invalid("kind must be service or product.");
  return NextResponse.json({ data: await listCategoriesApi(ctx.business.id, kind) });
});
