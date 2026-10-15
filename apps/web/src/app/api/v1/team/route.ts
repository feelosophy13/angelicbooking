import { route } from "@/lib/api";
import { listTeam } from "@/server/api-v1-team";

/** GET /api/v1/team: every team member, inactive ones included, with contact details. Pay, PINs, calendar tokens and logins are never included. */
export const GET = route("staff:read", (ctx, req) => listTeam(ctx, req));
