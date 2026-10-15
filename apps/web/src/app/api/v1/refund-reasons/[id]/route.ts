import { route } from "@/lib/api";
import { patchReasonApi } from "@/server/api-v1-settings";

/** PATCH /api/v1/refund-reasons/:id: rename, retire (active: false) or restore. */
export const PATCH = route<{ id: string }>("settings:write", (ctx, req, { id }) => patchReasonApi(ctx, req, id));
