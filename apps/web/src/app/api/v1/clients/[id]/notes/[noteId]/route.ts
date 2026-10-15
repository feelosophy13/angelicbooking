import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { serializeNote } from "@/server/api-v1-more";
import { findNoteApi, notePatch } from "@/server/api-v1-clients";

type P = { id: string; noteId: string };

/** PATCH /api/v1/clients/:id/notes/:noteId {pinned}: pin or unpin a note (the same as the pin button in the staff app). */
export const PATCH = route<P>("clients:write", async (ctx, req, { id, noteId }) => {
  const body = await readBody(req, notePatch);
  if ("error" in body) return body.error;
  const b = ctx.business.id;
  if (!(await findNoteApi(b, id, noteId))) return ApiErrors.notFound("note");
  const [row] = await withTenant(b, (tx) => tx.update(schema.clientNotes).set({ pinned: body.data.pinned }).where(and(eq(schema.clientNotes.id, noteId), eq(schema.clientNotes.clientId, id), eq(schema.clientNotes.businessId, b))).returning());
  await apiAudit(ctx, "api.client.note_pin", "client", id, { noteId, pinned: body.data.pinned });
  return NextResponse.json({ data: serializeNote(row!) });
});

/** DELETE /api/v1/clients/:id/notes/:noteId: notes are deleted outright in the staff app too. */
export const DELETE = route<P>("clients:write", async (ctx, _req, { id, noteId }) => {
  const b = ctx.business.id;
  const rows = await withTenant(b, (tx) => tx.delete(schema.clientNotes).where(and(eq(schema.clientNotes.id, noteId), eq(schema.clientNotes.clientId, id), eq(schema.clientNotes.businessId, b))).returning({ id: schema.clientNotes.id }));
  if (!rows.length) return ApiErrors.notFound("note");
  await apiAudit(ctx, "api.client.note_delete", "client", id, { noteId });
  return NextResponse.json({ data: { id: noteId, deleted: true } });
});
