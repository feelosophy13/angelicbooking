import { readBody, route } from "@/lib/api";
import { convertBody, convertToGroupApi, guarded } from "@/server/api-v1-catalog";

/** POST /api/v1/products/:id/convert-to-group: { label }. The product becomes the first option of a new group, so more options can be added to it. */
export const POST = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const body = await readBody(req, convertBody);
  if ("error" in body) return body.error;
  return guarded(() => convertToGroupApi(ctx, id, body.data));
});
