import { NextResponse } from "next/server";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, list, pageParams, probe, readBody, route } from "@/lib/api";
import { clientExists, listNotesApi, noteInput, serializeNote } from "@/server/api-v1-more";

export const GET = route<{ id: string }>("client-notes:read", async (ctx, req, { id }) => {
  if (!(await clientExists(ctx.business.id, id))) return ApiErrors.notFound("client");
  const p = pageParams(new URL(req.url));
  return list((await listNotesApi(ctx.business.id, id, probe(p))).map(serializeNote), p);
});

/** POST /api/v1/clients/:id/notes: add a private note (formula, allergy, preference). */
export const POST = route<{ id: string }>("client-notes:write", async (ctx, req, { id }) => {
  const body = await readBody(req, noteInput);
  if ("error" in body) return body.error;
  if (!(await clientExists(ctx.business.id, id))) return ApiErrors.notFound("client");
  const businessId = ctx.business.id;
  const [row] = await withTenant(businessId, (tx) => tx.insert(schema.clientNotes).values({ businessId, clientId: id, body: body.data.body, pinned: body.data.pinned }).returning());
  await apiAudit(ctx, "api.client.note", "client", id);
  return NextResponse.json({ data: serializeNote(row!) }, { status: 201 });
});
