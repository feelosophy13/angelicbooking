import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { ApiErrors, readBody, route } from "@/lib/api";
import { serializeProduct } from "@/server/api-v1";
import { guarded, patchProductApi, productPatchX } from "@/server/api-v1-catalog";

const find = (b: string, id: string) => withTenant(b, (tx) => tx.query.products.findFirst({ where: and(eq(schema.products.id, id), eq(schema.products.businessId, b)) }));

export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => {
  const p = await find(ctx.business.id, id);
  return p ? NextResponse.json({ data: serializeProduct(p) }) : ApiErrors.notFound("product");
});

/**
 * PATCH /api/v1/products/:id. Stock counts are changed through /stock-adjustments, never here. Set active=false to retire a product.
 * An option of a product (it has a group) keeps what the group shares (name, category, kind, tax, online store, supplier) in step with the group:
 * those are changed with PATCH /product-groups/:id and are refused here (409).
 */
export const PATCH = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const body = await readBody(req, productPatchX);
  if ("error" in body) return body.error;
  return guarded(() => patchProductApi(ctx, id, body.data));
});
