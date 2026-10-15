import { route } from "@/lib/api";
import { addOverrideApi, listOverridesApi } from "@/server/api-v1-team";

/** GET /api/v1/staff/:id/overrides: days off and changed hours from today (or ?from) on, with ids. */
export const GET = route<{ id: string }>("staff:read", (ctx, req, { id }) => listOverridesApi(ctx, req, id));
/** POST /api/v1/staff/:id/overrides: a day off or changed hours for one date or a range. */
export const POST = route<{ id: string }>("staff:write", (ctx, req, { id }) => addOverrideApi(ctx, req, id));
