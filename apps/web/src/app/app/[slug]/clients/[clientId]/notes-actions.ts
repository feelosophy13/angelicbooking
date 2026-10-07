"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction } from "@/lib/form";
import { setFlash } from "@/lib/flash";

export const addNote = formAction(z.object({ slug: z.string(), clientId: f.id(), body: f.text(1, 2000), pinned: f.checkbox() }), async (d) => {
  const ctx = await requireAction(d.slug, "clients.write");
  await withTenant(ctx.business.id, (tx) => tx.insert(schema.clientNotes).values({ businessId: ctx.business.id, clientId: d.clientId, authorUserId: ctx.user.id, body: d.body, pinned: d.pinned }));
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
  return "Note added";
});

export async function togglePin(formData: FormData) {
  const d = z.object({ slug: z.string(), clientId: z.string(), noteId: z.string(), pinned: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "clients.write");
  await withTenant(ctx.business.id, (tx) => tx.update(schema.clientNotes).set({ pinned: d.pinned === "true" }).where(eq(schema.clientNotes.id, d.noteId)));
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
}

export async function deleteNote(formData: FormData) {
  const d = z.object({ slug: z.string(), clientId: z.string(), noteId: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "clients.write");
  await withTenant(ctx.business.id, (tx) => tx.delete(schema.clientNotes).where(eq(schema.clientNotes.id, d.noteId)));
  await setFlash("Note deleted");
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
}
