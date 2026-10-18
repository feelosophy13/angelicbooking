"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { FileError, storeImage } from "@/lib/files";
import { resendNotification } from "@/lib/notify";
import { setFlash } from "@/lib/flash";
import { addNumberAsClient, markConversationRead, markConversationUnread, sendStaffText } from "@/server/inbound";

/** Opening a conversation marks it read; revalidating the layout refreshes the sidebar's unread badge. */
export async function markRead(slug: string, key: string) {
  const { business } = await requireAction(slug, "clients.read");
  await markConversationRead(business.id, key);
  revalidatePath(`/app/${slug}`, "layout");
}

/** "Mark unread": the conversation goes back to the top of the pile and the inbox opens, so it is not read again at once. */
export async function markUnread(formData: FormData) {
  const d = z.object({ slug: z.string(), key: z.string().min(1) }).parse(Object.fromEntries(formData));
  const { business } = await requireAction(d.slug, "clients.read");
  await markConversationUnread(business.id, d.key);
  revalidatePath(`/app/${d.slug}`, "layout");
  redirect(`/app/${d.slug}/inbox`);
}

/** A text typed at the desk, with an optional picture. Every send goes through the notification queue (consent, STOP, billing). */
export const replyToClient = formAction(z.object({ slug: z.string(), clientId: f.id(), body: z.string().trim().max(1000, "At most 1000 characters") }), async (d, raw) => {
  const ctx = await requireAction(d.slug, "clients.write");
  const picture = raw.get("image");
  let media: { url: string; type: string }[] = [];
  if (picture instanceof File && picture.size > 0) {
    try {
      const stored = await storeImage(ctx.business.id, "mms", picture);
      media = [{ url: stored.url, type: "image/jpeg" }];
    } catch (e) {
      if (e instanceof FileError) throw new FormError(e.message, "image");
      throw e;
    }
  }
  try {
    await sendStaffText(ctx.business, d.clientId, d.body, media);
  } catch (e) {
    throw new FormError((e as Error).message, "body");
  }
  revalidatePath(`/app/${d.slug}/clients/${d.clientId}`);
  revalidatePath(`/app/${d.slug}/inbox`, "layout");
});

/** "Send again" on a text that was not delivered: only a text to this client, so the desk cannot resend someone else's. */
export async function retryText(formData: FormData) {
  const d = z.object({ slug: z.string(), clientId: z.string().min(1), id: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "clients.write");
  const row = await withTenant(ctx.business.id, (tx) => tx.query.notifications.findFirst({ where: and(eq(schema.notifications.id, d.id), eq(schema.notifications.clientId, d.clientId), eq(schema.notifications.channel, "sms")), columns: { id: true } }));
  if (!row) throw new Error("Message not found");
  const r = await resendNotification(ctx.business.id, d.id);
  await setFlash(r.sent ? "Sent" : r.failed || r.skipped ? "Still not sent; the reason is under the message" : "Nothing to send", r.sent ? "success" : "error");
  revalidatePath(`/app/${d.slug}/inbox`, "layout");
}

export const addTextSenderAsClient = formAction(z.object({ slug: z.string(), number: z.string().min(5).max(20), firstName: f.text(1, 80), lastName: z.string().max(80).optional() }), async (d) => {
  const ctx = await requireAction(d.slug, "clients.write");
  const id = await addNumberAsClient(ctx.business.id, d.number, { firstName: d.firstName, lastName: d.lastName });
  revalidatePath(`/app/${d.slug}`, "layout");
  redirect(`/app/${d.slug}/inbox/${encodeURIComponent(id)}`);
});
