import { route } from "@/lib/api";
import { createReasonApi, listReasonsApi } from "@/server/api-v1-settings";

export const GET = route("settings:read", (ctx, req) => listReasonsApi(ctx, req));
export const POST = route("settings:write", (ctx, req) => createReasonApi(ctx, req));
