import { NextResponse } from "next/server";
import { MarketingError, sendCampaign } from "@/server/marketing";
import { ApiErrors, route } from "@/lib/api";
import { getCampaignApi, sendingGuard, serializeCampaign } from "@/server/api-v1-marketing";

/**
 * POST /api/v1/campaigns/:id/send: queue the campaign to everyone its audience matches (the same function the app's Send button calls).
 * A campaign can be sent once: a second call, or one made while the first is still running, answers 409.
 */
export const POST = route<{ id: string }>("campaigns:send", async (ctx, _req, { id }) => {
  const b = ctx.business.id;
  const c = await getCampaignApi(b, id);
  if (!c) return ApiErrors.notFound("campaign");
  if (c.status === "sent") return ApiErrors.conflict("This campaign was already sent.");
  if (!sendingGuard.tryAcquire(id)) return ApiErrors.conflict("This campaign is already being sent.");
  try {
    const queued = await sendCampaign(ctx.business, id, ctx.actor);
    const after = await getCampaignApi(b, id);
    return NextResponse.json({ data: { queued, campaign: after ? serializeCampaign(after) : null } });
  } catch (e) {
    if (e instanceof MarketingError) return ApiErrors.conflict(e.message);
    throw e;
  } finally {
    sendingGuard.release(id);
  }
});
