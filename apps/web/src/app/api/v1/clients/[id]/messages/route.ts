import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { clientThread, sendStaffText } from "@/server/inbound";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { replyInput } from "@/server/api-v1-messages";
import { clientExists } from "@/server/api-v1-more";

/** GET /api/v1/clients/:id/messages: the text conversation with one client (their replies and what was texted to them), oldest first. */
export const GET = route<{ id: string }>("messages:read", async (ctx, req, { id }) => {
  if (!(await clientExists(ctx.business.id, id))) return ApiErrors.notFound("client");
  const n = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 50));
  const items = await clientThread(ctx.business.id, id, n);
  return NextResponse.json({ data: items.map((m) => ({ id: m.id, direction: m.dir === "in" ? "inbound" : "outbound", body: m.body, at: m.at.toISOString(), status: m.status })) });
});

/**
 * POST /api/v1/clients/:id/messages: text the client (the staff reply from the client page). The text is queued like every other message.
 * A client with no mobile number, or who opted out of texts (STOP), answers 409 with the app's message and nothing is queued.
 */
export const POST = route<{ id: string }>("messages:write", async (ctx, req, { id }) => {
  const body = await readBody(req, replyInput);
  if ("error" in body) return body.error;
  const b = ctx.business.id;
  const client = await withTenant(b, (tx) => tx.query.clients.findFirst({ where: and(eq(schema.clients.id, id), eq(schema.clients.businessId, b)), columns: { id: true } }));
  if (!client) return ApiErrors.notFound("client");
  try {
    await sendStaffText(ctx.business, id, body.data.body);
  } catch (e) {
    return ApiErrors.conflict((e as Error).message);
  }
  await apiAudit(ctx, "api.client.message", "client", id);
  return NextResponse.json({ data: { client_id: id, status: "queued" } }, { status: 201 });
});
