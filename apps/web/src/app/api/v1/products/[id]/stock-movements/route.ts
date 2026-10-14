import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { ApiErrors, list, pageParams, route } from "@/lib/api";
import { serializeMovement } from "@/server/api-v1-more";

/** GET /api/v1/products/:id/stock-movements: every change to this product's stock, newest first. */
export const GET = route<{ id: string }>("inventory:read", async (ctx, req, { id }) => {
  const p = pageParams(new URL(req.url));
  const b = ctx.business.id;
  const out = await withTenant(b, async (tx) => {
    if (!(await tx.query.products.findFirst({ where: and(eq(schema.products.id, id), eq(schema.products.businessId, b)), columns: { id: true } }))) return null;
    return tx.select().from(schema.stockMovements).where(and(eq(schema.stockMovements.productId, id), eq(schema.stockMovements.businessId, b))).orderBy(desc(schema.stockMovements.createdAt)).limit(p.limit).offset(p.offset);
  });
  return out ? list(out.map(serializeMovement), p) : ApiErrors.notFound("product");
});
