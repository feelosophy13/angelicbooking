import { readBody, route } from "@/lib/api";
import { moveBody, moveServiceApi } from "@/server/api-v1-catalog";

/** POST /api/v1/services/:id/move: { direction: "up" | "down" } one step within its category. */
export const POST = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const body = await readBody(req, moveBody);
  if ("error" in body) return body.error;
  return moveServiceApi(ctx, id, body.data.direction);
});
