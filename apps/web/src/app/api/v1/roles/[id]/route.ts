import { route } from "@/lib/api";
import { deleteRoleApi, getRoleApi, patchRoleApi } from "@/server/api-v1-team";

export const GET = route<{ id: string }>("roles:read", (ctx, _req, { id }) => getRoleApi(ctx, id));
export const PATCH = route<{ id: string }>("roles:write", (ctx, req, { id }) => patchRoleApi(ctx, req, id));
export const DELETE = route<{ id: string }>("roles:delete", (ctx, _req, { id }) => deleteRoleApi(ctx, id));
