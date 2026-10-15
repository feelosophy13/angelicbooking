import { route } from "@/lib/api";
import { permissionCatalogue } from "@/server/api-v1-team";

/** GET /api/v1/roles/permissions: every permission a role can hold, grouped as in the role editor. */
export const GET = route("roles:read", async () => permissionCatalogue());
