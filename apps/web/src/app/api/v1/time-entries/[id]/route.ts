import { route } from "@/lib/api";
import { deleteTimeEntryApi } from "@/server/api-v1-team";

export const DELETE = route<{ id: string }>("time:delete", (ctx, _req, { id }) => deleteTimeEntryApi(ctx, id));
