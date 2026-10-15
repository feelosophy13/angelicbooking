import { schema, withTenant } from "@angelic/db";
import { ApiErrors, firstForeign, list, pageParams, route } from "@/lib/api";
import { listSubmissionsApi } from "@/server/api-v1-forms";

/** GET /api/v1/form-submissions?form_id=&client_id=&q=&include_voided=false: what clients submitted, newest first (a summary; the answers are on GET /form-submissions/:id). */
export const GET = route("forms:read", async (ctx, req) => {
  const url = new URL(req.url);
  const q = url.searchParams;
  const p = pageParams(url);
  const b = ctx.business.id;
  const formId = q.get("form_id") ?? undefined;
  const clientId = q.get("client_id") ?? undefined;
  const missing = await withTenant(b, (tx) => firstForeign(tx, b, [[schema.forms, formId, "form"], [schema.clients, clientId, "client"]]));
  if (missing) return ApiErrors.notFound(missing);
  const { rows, total } = await listSubmissionsApi(b, { formId, clientId, q: q.get("q")?.trim().slice(0, 100) || undefined, includeVoided: q.get("include_voided") !== "false", limit: p.limit, offset: p.offset });
  return list(rows, p, total);
});
