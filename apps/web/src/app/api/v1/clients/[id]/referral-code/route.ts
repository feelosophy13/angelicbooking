import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { apiAudit, ApiErrors, route } from "@/lib/api";
import { ensureReferralCode, LoyaltyError } from "@/server/loyalty";

const find = (tx: TenantDb, b: string, id: string) =>
  tx.query.clients.findFirst({ where: and(eq(schema.clients.id, id), eq(schema.clients.businessId, b)), columns: { id: true, firstName: true, businessId: true, referralCode: true } });

/** GET /api/v1/clients/:id/referral-code: the client's code, or null when none has been made yet. */
export const GET = route<{ id: string }>("clients:read", async (ctx, _req, { id }) => {
  const b = ctx.business.id;
  const c = await withTenant(b, (tx) => find(tx, b, id));
  return c ? NextResponse.json({ data: { client_id: c.id, referral_code: c.referralCode } }) : ApiErrors.notFound("client");
});

/** POST /api/v1/clients/:id/referral-code: make the client's referral code (returns the existing one if they already have it). Nothing is sent to the client. */
export const POST = route<{ id: string }>("clients:write", async (ctx, _req, { id }) => {
  const b = ctx.business.id;
  let result: { code: string; created: boolean } | null;
  try {
    result = await withTenant(b, async (tx) => {
      const c = await find(tx, b, id);
      if (!c) return null;
      return { code: await ensureReferralCode(tx, c), created: !c.referralCode };
    });
  } catch (e) {
    if (e instanceof LoyaltyError) return ApiErrors.conflict(e.message);
    throw e;
  }
  if (!result) return ApiErrors.notFound("client");
  if (result.created) await apiAudit(ctx, "api.client.referral_code", "client", id);
  return NextResponse.json({ data: { client_id: id, referral_code: result.code } }, { status: result.created ? 201 : 200 });
});
