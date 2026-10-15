import { eq, and, asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { list, pageParams, probe, readBody, route } from "@/lib/api";
import { createPlanApi, planCreate, serializePlanFull } from "@/server/api-v1-catalog";

/** GET /api/v1/membership-plans?include_inactive=1: the membership plans you sell (hidden ones only with include_inactive). */
export const GET = route("catalog:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const take = probe(p);
  const b = ctx.business.id;
  const all = url.searchParams.get("include_inactive") === "1";
  const rows = await withTenant(b, (tx) => tx.select().from(schema.membershipPlans).where(and(eq(schema.membershipPlans.businessId, b), all ? undefined : eq(schema.membershipPlans.active, true))).orderBy(asc(schema.membershipPlans.name)).limit(take.limit).offset(take.offset));
  return list(rows.map(serializePlanFull), p);
});

/** POST /api/v1/membership-plans. Configures a plan; enrolling a client (which bills them) happens at checkout, not here. */
export const POST = route("catalog:write", async (ctx, req) => {
  const body = await readBody(req, planCreate);
  if ("error" in body) return body.error;
  return createPlanApi(ctx, body.data);
});
