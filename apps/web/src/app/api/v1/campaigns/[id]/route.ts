import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { campaignStats } from "@/server/marketing";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { audienceForeign, campaignPatch, campaignRuleError, getCampaignApi, serializeCampaign, toAudience } from "@/server/api-v1-marketing";

/** GET /api/v1/campaigns/:id: one campaign; once sent, with its delivery counts. */
export const GET = route<{ id: string }>("marketing:read", async (ctx, _req, { id }) => {
  const c = await getCampaignApi(ctx.business.id, id);
  if (!c) return ApiErrors.notFound("campaign");
  const delivery = c.status === "sent" ? await campaignStats(ctx.business.id, c.id) : null;
  return NextResponse.json({ data: { ...serializeCampaign(c), delivery } });
});

/** PATCH /api/v1/campaigns/:id: edit a draft. A sent campaign cannot be edited (the app shows it read-only). `audience`, when given, replaces the whole audience. */
export const PATCH = route<{ id: string }>("marketing:write", async (ctx, req, { id }) => {
  const body = await readBody(req, campaignPatch);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const current = await getCampaignApi(b, id);
  if (!current) return ApiErrors.notFound("campaign");
  if (current.status === "sent") return ApiErrors.conflict("This campaign was already sent and can't be edited.");
  const next = {
    name: d.name ?? current.name,
    channel: d.channel ?? current.channel,
    subject: d.subject !== undefined ? d.subject || null : current.subject,
    body: d.body ?? current.body,
    audience: d.audience !== undefined ? toAudience(d.audience) : current.audience,
  };
  const rule = await campaignRuleError(b, next);
  if (rule) return ApiErrors.conflict(rule);
  const out = await withTenant(b, async (tx) => {
    const miss = d.audience !== undefined ? await audienceForeign(tx, b, next.audience) : null;
    if (miss) return { miss };
    // Re-check the status in the same statement so a send that landed meanwhile is not overwritten.
    const [row] = await tx.update(schema.campaigns).set(next).where(and(eq(schema.campaigns.id, id), eq(schema.campaigns.businessId, b), eq(schema.campaigns.status, "draft"))).returning();
    return { row };
  });
  if ("miss" in out) return ApiErrors.notFound(out.miss!);
  if (!out.row) return ApiErrors.conflict("This campaign was already sent and can't be edited.");
  await apiAudit(ctx, "api.campaign.update", "campaign", id, { fields: Object.keys(d) });
  return NextResponse.json({ data: serializeCampaign(out.row) });
});

/** DELETE /api/v1/campaigns/:id: delete a campaign (messages it already queued stay in the log, as in the app). */
export const DELETE = route<{ id: string }>("marketing:write", async (ctx, _req, { id }) => {
  const b = ctx.business.id;
  const rows = await withTenant(b, (tx) => tx.delete(schema.campaigns).where(and(eq(schema.campaigns.id, id), eq(schema.campaigns.businessId, b))).returning({ id: schema.campaigns.id }));
  if (!rows.length) return ApiErrors.notFound("campaign");
  await apiAudit(ctx, "api.campaign.delete", "campaign", id);
  return NextResponse.json({ data: { id, deleted: true } });
});
