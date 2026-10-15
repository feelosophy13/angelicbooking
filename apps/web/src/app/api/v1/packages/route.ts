import { eq, and, asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { list, pageParams, readBody, route } from "@/lib/api";
import { createPackageApi, packageCreate, serializePackageFull } from "@/server/api-v1-catalog";

/** GET /api/v1/packages?include_inactive=1: the prepaid session packages you sell (hidden ones only with include_inactive). */
export const GET = route("catalog:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const b = ctx.business.id;
  const all = url.searchParams.get("include_inactive") === "1";
  const rows = await withTenant(b, (tx) => tx.select().from(schema.packages).where(and(eq(schema.packages.businessId, b), all ? undefined : eq(schema.packages.active, true))).orderBy(asc(schema.packages.name)).limit(p.limit).offset(p.offset));
  return list(rows.map(serializePackageFull), p);
});

/** POST /api/v1/packages. Configures what you sell; selling one to a client happens at checkout, not here. */
export const POST = route("catalog:write", async (ctx, req) => {
  const body = await readBody(req, packageCreate);
  if ("error" in body) return body.error;
  return createPackageApi(ctx, body.data);
});
