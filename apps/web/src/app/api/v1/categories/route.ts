import { ApiErrors, readBody, route } from "@/lib/api";
import { categoryCreate, createCategoryApi, guarded, kindOf, listCategoriesFull } from "@/server/api-v1-catalog";
import { NextResponse } from "next/server";

/** GET /api/v1/categories?kind=service|product (default service). Service categories nest through parent_id. */
export const GET = route("catalog:read", async (ctx, req) => {
  const kind = kindOf(new URL(req.url));
  if (!kind) return ApiErrors.invalid("kind must be service or product.");
  return NextResponse.json({ data: await listCategoriesFull(ctx.business.id, kind) });
});

/** POST /api/v1/categories: { kind, name, parent_id?, description?, prep_notes? }. Product categories are flat and only have a name. */
export const POST = route("catalog:write", async (ctx, req) => {
  const body = await readBody(req, categoryCreate);
  if ("error" in body) return body.error;
  return guarded(() => createCategoryApi(ctx, body.data));
});
