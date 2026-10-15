"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { f, formAction } from "@/lib/form";
import { addNumberAsClient, markConversationRead } from "@/server/inbound";

/** Opening a conversation marks it read; revalidating the layout refreshes the sidebar's unread badge. */
export async function markRead(slug: string, key: string) {
  const { business } = await requireAction(slug, "clients.read");
  await markConversationRead(business.id, key);
  revalidatePath(`/app/${slug}`, "layout");
}

export const addTextSenderAsClient = formAction(z.object({ slug: z.string(), number: z.string().min(5).max(20), firstName: f.text(1, 80), lastName: z.string().max(80).optional() }), async (d) => {
  const ctx = await requireAction(d.slug, "clients.write");
  const id = await addNumberAsClient(ctx.business.id, d.number, { firstName: d.firstName, lastName: d.lastName });
  revalidatePath(`/app/${d.slug}`, "layout");
  redirect(`/app/${d.slug}/inbox/${encodeURIComponent(id)}`);
});
