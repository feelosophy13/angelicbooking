import { route } from "@/lib/api";
import { createRoleApi, listRolesApi } from "@/server/api-v1-team";

export const GET = route("roles:read", (ctx) => listRolesApi(ctx));
export const POST = route("roles:write", (ctx, req) => createRoleApi(ctx, req));
