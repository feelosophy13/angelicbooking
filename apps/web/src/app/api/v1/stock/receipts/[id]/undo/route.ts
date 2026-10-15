import { route } from "@/lib/api";
import { guarded } from "@/server/api-v1-catalog";
import { undoReceiptApi } from "@/server/api-v1-inventory";

/** POST /api/v1/stock/receipts/:id/undo: take back a delivery entered wrong (:id is the stock movement's id). 409 when some of it has already gone. */
export const POST = route<{ id: string }>("inventory:write", async (ctx, _req, { id }) => guarded(() => undoReceiptApi(ctx, id)));
