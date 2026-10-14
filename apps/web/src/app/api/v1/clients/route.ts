import { NextResponse } from "next/server";
import { eq, or, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { apiAudit, list, pageParams, readBody, route } from "@/lib/api";
import { clientBody, getClientApi, listClientsApi, serializeClient } from "@/server/api-v1";

/** GET /api/v1/clients?q=&email=&phone=&updated_since=&page=&limit= */
export const GET = route("clients:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const phone = url.searchParams.get("phone");
  const since = url.searchParams.get("updated_since");
  const { rows, total } = await listClientsApi(ctx.business.id, {
    q: url.searchParams.get("q") ?? undefined,
    email: url.searchParams.get("email") ?? undefined,
    phone: phone ? (normalizePhone(phone) ?? phone) : undefined,
    updatedSince: since && !Number.isNaN(Date.parse(since)) ? new Date(since) : null,
    limit: p.limit,
    offset: p.offset,
  });
  return list(rows.map(serializeClient), p, total);
});

/** POST /api/v1/clients. A client with the same email or phone already on file is a 409 that names the existing id. */
export const POST = route("clients:write", async (ctx, req) => {
  const body = await readBody(req, clientBody);
  if ("error" in body) return body.error;
  const d = body.data;
  const phone = d.phone ? (normalizePhone(d.phone) ?? d.phone) : null;
  const businessId = ctx.business.id;
  const result = await withTenant(businessId, async (tx) => {
    const conds = [...(d.email ? [sql`lower(${schema.clients.email}) = ${d.email}`] : []), ...(phone ? [eq(schema.clients.phone, phone)] : [])];
    const dup = conds.length ? await tx.query.clients.findFirst({ where: or(...conds), columns: { id: true } }) : null;
    if (dup) return { duplicate: dup.id };
    const [row] = await tx
      .insert(schema.clients)
      .values({ businessId, firstName: d.first_name, lastName: d.last_name, email: d.email ?? null, phone, notes: d.notes ?? null, tags: d.tags ?? [], birthday: d.birthday ?? null, smsOptIn: d.sms_opt_in, emailOptIn: d.email_opt_in })
      .returning({ id: schema.clients.id });
    return { id: row!.id };
  });
  if ("duplicate" in result) return NextResponse.json({ error: { code: "conflict", message: "A client with that email or phone already exists.", existing_id: result.duplicate } }, { status: 409 });
  await apiAudit(ctx, "client.create", "client", result.id);
  const created = await getClientApi(businessId, result.id);
  return NextResponse.json({ data: serializeClient(created!) }, { status: 201 });
});
