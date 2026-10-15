import { route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { undoUsageMovementApi } from "@/server/api-v1-inventory";

/** POST /api/v1/stock/usage/:id/undo: take back a use logged by mistake (:id is the stock movement's id). Once only; a use logged on a visit is taken back on that visit. */
export const POST = route<{ id: string }>("inventory:write", async (ctx, _req, { id }) => guarded(() => undoUsageMovementApi(ctx, id)));
