import { route } from "@/lib/api";
import { addTimeEntryApi, listTimeEntriesApi } from "@/server/api-v1-team";

export const GET = route("staff:read", (ctx, req) => listTimeEntriesApi(ctx, req));
export const POST = route("staff:write", (ctx, req) => addTimeEntryApi(ctx, req));
