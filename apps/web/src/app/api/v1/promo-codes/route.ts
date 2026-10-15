import { NextResponse } from "next/server";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, firstForeign, list, pageParams, readBody, route } from "@/lib/api";
import { listPromosApi, normalizePromoCode, promoCreate, promoEnd, promoStart, serializePromo } from "@/server/api-v1-marketing";

/** GET /api/v1/promo-codes?active=true|false: promo codes, active ones first. */
export const GET = route("marketing:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const a = url.searchParams.get("active");
  return list((await listPromosApi(ctx.business.id, p, a === "true" ? true : a === "false" ? false : undefined)).map(serializePromo), p);
});

/** POST /api/v1/promo-codes: create a code (the app's rules: letters/digits/dashes only, percent 1-100 or an amount in cents, unique per business). */
export const POST = route("marketing:write", async (ctx, req) => {
  const body = await readBody(req, promoCreate);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const code = normalizePromoCode(d.code);
  if (code.length < 2) return ApiErrors.invalid("Some fields are invalid.", [{ path: "code", message: "Letters and numbers only" }]);
  if (d.type === "percent" && d.value > 100) return ApiErrors.invalid("Some fields are invalid.", [{ path: "value", message: "Percent between 1 and 100" }]);
  const serviceIds = [...new Set(d.service_ids ?? [])];
  const out = await withTenant(b, async (tx) => {
    const miss = await firstForeign(tx, b, serviceIds.map((id) => [schema.services, id, "service"] as [typeof schema.services, string, string]));
    if (miss) return { miss };
    const exists = await tx.query.promoCodes.findFirst({ where: (t, { and, eq }) => and(eq(t.businessId, b), eq(t.code, code)), columns: { id: true } });
    if (exists) return { dup: true as const };
    try {
      const [row] = await tx.insert(schema.promoCodes).values({
        businessId: b, code, type: d.type, value: d.value, startsAt: promoStart(d.starts_on, ctx.business.timezone), expiresAt: promoEnd(d.expires_on, ctx.business.timezone),
        maxUses: d.max_uses ?? null, serviceIds, minSubtotalCents: d.min_subtotal_cents ?? 0,
      }).returning();
      return { row: row! };
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return { dup: true as const };
      throw e;
    }
  });
  if ("miss" in out) return ApiErrors.notFound(out.miss!);
  if ("dup" in out) return ApiErrors.conflict("That code already exists");
  await apiAudit(ctx, "api.promo.create", "promo_code", out.row.id, { code });
  return NextResponse.json({ data: serializePromo(out.row) }, { status: 201 });
});
