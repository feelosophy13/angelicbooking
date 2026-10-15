import { ApiErrors, readBody, route } from "@/lib/api";
import { deleteCategoryApi, getCategoryApi, guarded, kindOf, productCategoryPatch, serviceCategoryPatch, updateCategoryApi } from "@/server/api-v1-catalog";

const kindOrError = (req: Request) => kindOf(new URL(req.url));

/** GET /api/v1/categories/:id?kind=service|product (default service). */
export const GET = route<{ id: string }>("catalog:read", async (ctx, req, { id }) => {
  const kind = kindOrError(req);
  if (!kind) return ApiErrors.invalid("kind must be service or product.");
  return getCategoryApi(ctx.business.id, kind, id);
});

/** PATCH /api/v1/categories/:id?kind=...: send only what changes. A service category may move under another with parent_id (never inside itself: 409). */
export const PATCH = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const kind = kindOrError(req);
  if (!kind) return ApiErrors.invalid("kind must be service or product.");
  const body = await readBody(req, kind === "service" ? serviceCategoryPatch : productCategoryPatch);
  if ("error" in body) return body.error;
  return guarded(() => updateCategoryApi(ctx, kind, id, body.data as { name?: string; parent_id?: string | null; description?: string | null; prep_notes?: string | null }));
});

/** DELETE /api/v1/categories/:id?kind=...: its items become uncategorised and its sub-categories move up a level. */
export const DELETE = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const kind = kindOrError(req);
  if (!kind) return ApiErrors.invalid("kind must be service or product.");
  return guarded(() => deleteCategoryApi(ctx, kind, id));
});
