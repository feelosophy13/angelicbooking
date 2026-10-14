import { schema } from "@angelic/db";
import { ApiErrors, list, pageParams, route } from "@/lib/api";
import { listSalesApi, serializeSale } from "@/server/api-v1";

const when = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);
const STATUSES = schema.saleStatus.enumValues as readonly string[];

/** GET /api/v1/sales?from=&to=&status=&client_id= */
export const GET = route("sales:read", async (ctx, req) => {
  const q = new URL(req.url).searchParams;
  const p = pageParams(new URL(req.url));
  const status = q.get("status");
  if (status && !STATUSES.includes(status)) return ApiErrors.invalid(`status must be one of: ${STATUSES.join(", ")}`);
  const { rows, total } = await listSalesApi(ctx.business.id, { from: when(q.get("from")), to: when(q.get("to")), status: status ?? undefined, clientId: q.get("client_id") ?? undefined, limit: p.limit, offset: p.offset });
  return list(rows.map((s) => serializeSale(s)), p, total);
});
