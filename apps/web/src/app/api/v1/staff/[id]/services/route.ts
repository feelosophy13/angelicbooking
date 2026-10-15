import { PRICE_FIELDS, route } from "@/lib/api";
import { getStaffServicesApi, putStaffServicesApi } from "@/server/api-v1-team";

export const GET = route<{ id: string }>("staff:read", (ctx, _req, { id }) => getStaffServicesApi(ctx, id));
/** PUT /api/v1/staff/:id/services: replace which services they perform, with their own price and length where they differ. */
export const PUT = route<{ id: string }>("staff:write", (ctx, req, { id }) => putStaffServicesApi(ctx, req, id), { fields: PRICE_FIELDS });
