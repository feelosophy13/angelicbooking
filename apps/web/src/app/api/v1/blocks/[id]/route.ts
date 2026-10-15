import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, route } from "@/lib/api";

/** DELETE /api/v1/blocks/:id: remove blocked time. Only blocks: a client's appointment is never deleted through here (cancel it instead). */
export const DELETE = route<{ id: string }>("appointments:delete", async (ctx, _req, { id }) => {
  const b = ctx.business.id;
  const rows = await withTenant(b, (tx) => tx.delete(schema.appointments).where(and(eq(schema.appointments.id, id), eq(schema.appointments.businessId, b), eq(schema.appointments.kind, "block"))).returning({ id: schema.appointments.id }));
  if (!rows.length) return ApiErrors.notFound("block");
  await apiAudit(ctx, "api.block.delete", "appointment", id);
  return NextResponse.json({ data: { id, deleted: true } });
});
