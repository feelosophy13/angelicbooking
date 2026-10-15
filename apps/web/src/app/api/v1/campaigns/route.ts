import { NextResponse } from "next/server";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, list, pageParams, readBody, route } from "@/lib/api";
import { audienceForeign, campaignCreate, campaignRuleError, listCampaignsApi, serializeCampaign, toAudience } from "@/server/api-v1-marketing";

/** GET /api/v1/campaigns?status=draft|sent: campaigns, newest first. */
export const GET = route("marketing:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const status = url.searchParams.get("status");
  return list((await listCampaignsApi(ctx.business.id, p, status === "draft" || status === "sent" ? status : undefined)).map(serializeCampaign), p);
});

/** POST /api/v1/campaigns: create a draft. Nothing is sent until POST /campaigns/:id/send. */
export const POST = route("marketing:write", async (ctx, req) => {
  const body = await readBody(req, campaignCreate);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const audience = toAudience(d.audience);
  const subject = d.subject || null;
  const rule = await campaignRuleError(b, { channel: d.channel, subject, body: d.body });
  if (rule) return ApiErrors.conflict(rule);
  const out = await withTenant(b, async (tx) => {
    const miss = await audienceForeign(tx, b, audience);
    if (miss) return { miss };
    const [row] = await tx.insert(schema.campaigns).values({ businessId: b, name: d.name, channel: d.channel, subject, body: d.body, audience, createdByUserId: ctx.actor }).returning();
    return { row: row! };
  });
  if ("miss" in out) return ApiErrors.notFound(out.miss!);
  await apiAudit(ctx, "api.campaign.create", "campaign", out.row.id);
  return NextResponse.json({ data: serializeCampaign(out.row) }, { status: 201 });
});
