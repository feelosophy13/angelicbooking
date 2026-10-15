import { route } from "@/lib/api";
import { deleteOverrideApi } from "@/server/api-v1-team";

export const DELETE = route<{ id: string; overrideId: string }>("staff:write", (ctx, _req, { id, overrideId }) => deleteOverrideApi(ctx, id, overrideId));
