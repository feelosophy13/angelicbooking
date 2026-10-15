import { NextResponse } from "next/server";
import { withTenant } from "@angelic/db";
import { audienceClients } from "@/server/marketing";
import { ApiErrors, readBody, route } from "@/lib/api";
import { audienceForeign, audiencePreviewInput, toAudience } from "@/server/api-v1-marketing";

/** POST /api/v1/campaigns/audience-preview: the same count for an audience you have not saved yet. Sends nothing. */
export const POST = route("marketing:read", async (ctx, req) => {
  const body = await readBody(req, audiencePreviewInput);
  if ("error" in body) return body.error;
  const b = ctx.business.id;
  const audience = toAudience(body.data.audience);
  const out = await withTenant(b, async (tx) => {
    const miss = await audienceForeign(tx, b, audience);
    if (miss) return { miss };
    return { clients: await audienceClients(tx, ctx.business, audience, body.data.channel) };
  });
  if ("miss" in out) return ApiErrors.notFound(out.miss!);
  return NextResponse.json({ data: { count: out.clients.length, sample: out.clients.slice(0, 8).map((x) => ({ id: x.id, first_name: x.firstName, last_name: x.lastName })) } });
});
