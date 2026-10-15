"use server";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/tenant";
import { markConversationRead } from "@/server/inbound";

/** Opening a conversation marks it read; revalidating the layout refreshes the sidebar's unread badge. */
export async function markRead(slug: string, key: string) {
  const { business } = await requireAction(slug, "clients.read");
  await markConversationRead(business.id, key);
  revalidatePath(`/app/${slug}`, "layout");
}
