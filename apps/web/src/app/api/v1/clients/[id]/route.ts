import { NextResponse } from "next/server";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { apiAudit, ApiErrors, readBody, route, CLIENT_FIELDS } from "@/lib/api";
import { clientPatch, getClientApi, serializeClient } from "@/server/api-v1";
import { isSmsSuppressed } from "@/server/consent";

export const GET = route<{ id: string }>("clients:read", async (ctx, _req, { id }) => {
  const c = await getClientApi(ctx.business.id, id);
  return c ? NextResponse.json({ data: serializeClient(c, ctx.scopes) }) : ApiErrors.notFound("client");
});

/** PATCH /api/v1/clients/:id: send only the fields to change. */
export const PATCH = route<{ id: string }>("clients:write", async (ctx, req, { id }) => {
  const body = await readBody(req, clientPatch);
  if ("error" in body) return body.error;
  const d = body.data;
  const businessId = ctx.business.id;
  const phone = d.phone === undefined ? undefined : d.phone ? (normalizePhone(d.phone) ?? d.phone) : null;
  const outcome = await withTenant(businessId, async (tx) => {
    const existing = await tx.query.clients.findFirst({ where: and(eq(schema.clients.id, id), eq(schema.clients.businessId, businessId)), columns: { id: true } });
    if (!existing) return "missing" as const;
    const conds = [...(d.email ? [sql`lower(${schema.clients.email}) = ${d.email}`] : []), ...(phone ? [eq(schema.clients.phone, phone)] : [])];
    const dup = conds.length ? await tx.query.clients.findFirst({ where: and(ne(schema.clients.id, id), or(...conds)), columns: { id: true } }) : null;
    if (dup) return "duplicate" as const;
    // A number that replied STOP can only be turned back on by the person texting START.
    if (d.sms_opt_in === true) {
      const cur = await tx.query.clients.findFirst({ where: eq(schema.clients.id, id), columns: { phone: true } });
      if (await isSmsSuppressed(tx, phone !== undefined ? phone : cur?.phone)) return "stopped" as const;
    }
    await tx
      .update(schema.clients)
      .set({
        ...(d.first_name !== undefined ? { firstName: d.first_name } : {}),
        ...(d.last_name !== undefined ? { lastName: d.last_name } : {}),
        ...(d.email !== undefined ? { email: d.email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(d.notes !== undefined ? { notes: d.notes } : {}),
        ...(d.tags !== undefined ? { tags: d.tags } : {}),
        ...(d.birthday !== undefined ? { birthday: d.birthday } : {}),
        ...(d.sms_opt_in !== undefined ? { smsOptIn: d.sms_opt_in } : {}),
        ...(d.email_opt_in !== undefined ? { emailOptIn: d.email_opt_in } : {}),
      })
      .where(and(eq(schema.clients.id, id), eq(schema.clients.businessId, businessId)));
    return "ok" as const;
  });
  if (outcome === "missing") return ApiErrors.notFound("client");
  if (outcome === "duplicate") return ApiErrors.conflict("Another client already has that email or phone.");
  if (outcome === "stopped") return ApiErrors.conflict("This number replied STOP. Texts come back on only when the person texts START.");
  await apiAudit(ctx, "client.update", "client", id, { fields: Object.keys(d) });
  return NextResponse.json({ data: serializeClient((await getClientApi(businessId, id))!, ctx.scopes) });
}, { fields: CLIENT_FIELDS });
