import { NextResponse } from "next/server";
import { withTenant } from "@angelic/db";
import { audienceClients } from "@/server/marketing";
import { ApiErrors, route } from "@/lib/api";
import { getCampaignApi } from "@/server/api-v1-marketing";

/** GET /api/v1/campaigns/:id/audience: how many clients the campaign would reach right now on its channel, with a few example names. */
export const GET = route<{ id: string }>("marketing:read", async (ctx, _req, { id }) => {
  const c = await getCampaignApi(ctx.business.id, id);
  if (!c) return ApiErrors.notFound("campaign");
  const clients = await withTenant(ctx.business.id, (tx) => audienceClients(tx, ctx.business, c.audience, c.channel));
  return NextResponse.json({ data: { count: clients.length, sample: clients.slice(0, 8).map((x) => ({ id: x.id, first_name: x.firstName, last_name: x.lastName })) } });
});
