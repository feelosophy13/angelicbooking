import { route } from "@/lib/api";
import { getTeamMember } from "@/server/api-v1-team";

export const GET = route<{ id: string }>("staff:read", (ctx, _req, { id }) => getTeamMember(ctx, id));
