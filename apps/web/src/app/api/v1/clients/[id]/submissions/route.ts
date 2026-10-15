import { ApiErrors, list, pageParams, probe, route } from "@/lib/api";
import { clientExists } from "@/server/api-v1-more";
import { listClientSubmissionsApi, serializeClientSubmission } from "@/server/api-v1-clients";

/** GET /api/v1/clients/:id/submissions: the forms this client has filled in, newest first (a summary: read the answers with GET /form-submissions/:id). */
export const GET = route<{ id: string }>("clients:read", async (ctx, req, { id }) => {
  if (!(await clientExists(ctx.business.id, id))) return ApiErrors.notFound("client");
  const p = pageParams(new URL(req.url));
  const rows = await listClientSubmissionsApi(ctx.business.id, id, probe(p));
  return list(rows.map((r) => serializeClientSubmission(r.s, { name: r.formName, kind: r.formKind })), p);
});
