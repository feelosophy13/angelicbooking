import { schema } from "@angelic/db";
import { ApiErrors, list, pageParams, route } from "@/lib/api";
import { listAppointmentsApi } from "@/server/api-v1";
import { clientExists } from "@/server/api-v1-more";

const STATUSES = schema.appointmentStatus.enumValues as readonly string[];
const when = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);

/** GET /api/v1/clients/:id/appointments?from=&to=&status=: this client's visits (not blocked time), earliest first. Same shape as GET /appointments. */
export const GET = route<{ id: string }>("clients:read", async (ctx, req, { id }) => {
  if (!(await clientExists(ctx.business.id, id))) return ApiErrors.notFound("client");
  const url = new URL(req.url);
  const q = url.searchParams;
  const p = pageParams(url);
  const status = q.get("status");
  if (status && !STATUSES.includes(status)) return ApiErrors.invalid(`status must be one of: ${STATUSES.join(", ")}`);
  const { rows, total } = await listAppointmentsApi(ctx.business.id, { clientId: id, from: when(q.get("from")), to: when(q.get("to")), status: status ?? undefined, limit: p.limit, offset: p.offset });
  return list(rows, p, total);
});
