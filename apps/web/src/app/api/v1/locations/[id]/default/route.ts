import { route } from "@/lib/api";
import { setDefaultLocationApi } from "@/server/api-v1-settings";

/** POST /api/v1/locations/:id/default: make this the default location. */
export const POST = route<{ id: string }>("settings:write", (ctx, _req, { id }) => setDefaultLocationApi(ctx, id));
