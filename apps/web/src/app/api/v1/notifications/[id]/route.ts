import { NextResponse } from "next/server";
import { ApiErrors, route } from "@/lib/api";
import { getNotificationApi, serializeNotification } from "@/server/api-v1-messages";

export const GET = route<{ id: string }>("messages:read", async (ctx, _req, { id }) => {
  const n = await getNotificationApi(ctx.business.id, id);
  return n ? NextResponse.json({ data: serializeNotification(n) }) : ApiErrors.notFound("message");
});
