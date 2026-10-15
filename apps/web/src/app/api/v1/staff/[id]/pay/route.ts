import { route } from "@/lib/api";
import { getPayApi, putPayApi } from "@/server/api-v1-team";

export const GET = route<{ id: string }>("pay:read", (ctx, _req, { id }) => getPayApi(ctx, id));
/** PUT /api/v1/staff/:id/pay: record a pay change effective from a date (default today). */
export const PUT = route<{ id: string }>("pay:write", (ctx, req, { id }) => putPayApi(ctx, req, id));
