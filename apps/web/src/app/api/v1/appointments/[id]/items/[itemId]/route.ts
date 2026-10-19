import { NextResponse, after } from "next/server";
import { apiAudit, ApiErrors, route } from "@/lib/api";
import { getAppointmentApi } from "@/server/api-v1";
import { findVisitItem } from "@/server/api-v1-appointments";
import { removeServiceFromAppointment } from "@/server/booking";
import { appointmentChangedSilently, notifyAppointment } from "@/lib/notify";

/**
 * DELETE /api/v1/appointments/:id/items/:itemId?notify=false: take one service off a visit (all of its segments). Taking off the last one cancels the
 * visit, and then the client is told unless notify=false. A completed, no-show or cancelled visit cannot be changed (409).
 */
export const DELETE = route<{ id: string; itemId: string }>("appointments:cancel", async (ctx, req, { id, itemId }) => {
  const b = ctx.business.id;
  const found = await findVisitItem(b, id, itemId);
  if (!found) return ApiErrors.notFound("appointment item");
  if (["cancelled", "completed", "no_show"].includes(found.appointment.status)) return ApiErrors.conflict(`A ${found.appointment.status.replace("_", " ")} appointment cannot be changed.`);
  if (found.item.status === "cancelled") return ApiErrors.conflict("That service was already removed.");
  const r = await removeServiceFromAppointment({ businessId: b, itemId, actorUserId: ctx.actor });
  await apiAudit(ctx, "api.appointment.remove_service", "appointment", id, { itemId, visitCancelled: !!r?.cancelled });
  if (r?.cancelled) {
    if (new URL(req.url).searchParams.get("notify") !== "false") after(() => notifyAppointment(ctx.business, id, "cancellation").catch((e) => console.error("[api/v1] notify failed", (e as Error).message)));
    else after(() => appointmentChangedSilently(ctx.business, id, "cancelled"));
  }
  return NextResponse.json({ data: await getAppointmentApi(b, id) });
});
