import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { getPromoApi, promoPatch, serializePromo } from "@/server/api-v1-marketing";

export const GET = route<{ id: string }>("marketing:read", async (ctx, _req, { id }) => {
  const p = await getPromoApi(ctx.business.id, id);
  return p ? NextResponse.json({ data: serializePromo(p) }) : ApiErrors.notFound("promo code");
});

/** PATCH /api/v1/promo-codes/:id: turn a code on or off. That is all the app lets you change; create a new code for anything else. */
export const PATCH = route<{ id: string }>("marketing:write", async (ctx, req, { id }) => {
  const body = await readBody(req, promoPatch);
  if ("error" in body) return body.error;
  const b = ctx.business.id;
  const [row] = await withTenant(b, (tx) => tx.update(schema.promoCodes).set({ active: body.data.active }).where(and(eq(schema.promoCodes.id, id), eq(schema.promoCodes.businessId, b))).returning());
  if (!row) return ApiErrors.notFound("promo code");
  await apiAudit(ctx, "api.promo.toggle", "promo_code", id, { active: row.active });
  return NextResponse.json({ data: serializePromo(row) });
});
