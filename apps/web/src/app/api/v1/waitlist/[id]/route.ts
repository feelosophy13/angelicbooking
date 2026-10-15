import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { serializeWaitlist } from "@/server/api-v1-more";

const body = z.object({ status: z.enum(["open", "booked", "closed"]) }).strict();

/** PATCH /api/v1/waitlist/:id {status} */
export const PATCH = route<{ id: string }>("waitlist:write", async (ctx, req, { id }) => {
  const parsed = await readBody(req, body);
  if ("error" in parsed) return parsed.error;
  const b = ctx.business.id;
  const [row] = await withTenant(b, (tx) => tx.update(schema.waitlist).set({ status: parsed.data.status }).where(and(eq(schema.waitlist.id, id), eq(schema.waitlist.businessId, b))).returning());
  if (!row) return ApiErrors.notFound("waitlist entry");
  await apiAudit(ctx, "api.waitlist.update", "waitlist", id, parsed.data);
  return NextResponse.json({ data: serializeWaitlist(row) });
});
