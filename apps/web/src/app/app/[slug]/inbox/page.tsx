import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { unreadCount } from "@/server/inbound";

export const metadata: Metadata = { title: "Inbox" };

/** On a phone the list (in the layout) is the page. On a desktop this is the empty right pane until a conversation is picked. */
export default async function InboxPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "clients.messages");
  const unread = await unreadCount(business.id);
  return (
    <div className="hidden rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500 lg:block">
      {unread ? `${unread} unread text${unread === 1 ? "" : "s"}. Pick a conversation to read and reply.` : "Pick a conversation to read it and reply."}
      <span className="mt-1 block text-xs text-stone-400">↑ ↓ or J K move between conversations · / searches</span>
    </div>
  );
}
