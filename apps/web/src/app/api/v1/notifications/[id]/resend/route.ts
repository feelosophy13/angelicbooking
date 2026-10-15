import { NextResponse } from "next/server";
import { resendNotification } from "@/lib/notify";
import { apiAudit, ApiErrors, route } from "@/lib/api";
import { getNotificationApi, serializeNotification } from "@/server/api-v1-messages";

/**
 * POST /api/v1/notifications/:id/resend: try a failed or skipped message again, now (the app's "Resend" button). Anything else answers 409.
 * The result says how the attempt went; the message is returned with its new status.
 */
export const POST = route<{ id: string }>("messages:resend", async (ctx, _req, { id }) => {
  const b = ctx.business.id;
  const n = await getNotificationApi(b, id);
  if (!n) return ApiErrors.notFound("message");
  if (n.status !== "failed" && n.status !== "skipped") return ApiErrors.conflict("Only failed or skipped messages can be sent again.");
  const r = await resendNotification(b, id);
  await apiAudit(ctx, "api.notification.resend", "notification", id, { sent: r.sent, failed: r.failed, skipped: r.skipped });
  const after = await getNotificationApi(b, id);
  return NextResponse.json({ data: { sent: r.sent, failed: r.failed, skipped: r.skipped, message: serializeNotification(after ?? n) } });
});
