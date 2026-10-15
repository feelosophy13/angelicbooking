import { ApiErrors, readBody, route } from "@/lib/api";
import { guarded, kindOf, moveBody, moveCategoryApi } from "@/server/api-v1-catalog";

/** POST /api/v1/categories/:id/move?kind=...: { direction: "up" | "down" } one step among its siblings. Returns the renumbered list. */
export const POST = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const kind = kindOf(new URL(req.url));
  if (!kind) return ApiErrors.invalid("kind must be service or product.");
  const body = await readBody(req, moveBody);
  if ("error" in body) return body.error;
  return guarded(() => moveCategoryApi(ctx, kind, id, body.data.direction));
});
