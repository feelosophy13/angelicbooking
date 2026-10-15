import { route } from "@/lib/api";
import { moveReasonApi } from "@/server/api-v1-settings";

/** POST /api/v1/refund-reasons/:id/move: swap places with the neighbour above or below. */
export const POST = route<{ id: string }>("settings:write", (ctx, req, { id }) => moveReasonApi(ctx, req, id));
