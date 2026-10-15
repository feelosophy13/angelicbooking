import { route } from "@/lib/api";
import { getSettingsApi, patchSettingsApi } from "@/server/api-v1-settings";

export const GET = route("settings:read", (ctx) => getSettingsApi(ctx, "notifications"));
export const PATCH = route("settings:write", (ctx, req) => patchSettingsApi(ctx, req, "notifications"));
