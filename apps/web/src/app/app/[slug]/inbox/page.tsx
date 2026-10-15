import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { Card, Empty, PageHeader } from "@/components/ui";
import { rowClass, RowLink } from "@/components/row";
import { relative } from "@/lib/format";
import { listConversations } from "@/server/inbound";

export const metadata: Metadata = { title: "Inbox" };

/** Every text conversation with clients, newest first. Open one to read it and reply. */
export default async function InboxPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "clients.read");
  const conversations = await listConversations(business.id);
  const unread = conversations.reduce((n, c) => n + c.unread, 0);
  return (
    <>
      <PageHeader title={unread ? `Inbox (${unread} unread)` : "Inbox"} />
      {conversations.length === 0 ? (
        <Empty title="No conversations yet" body="When a client texts your number, the conversation appears here. You can reply from the same place." />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {conversations.map((c) => (
              <li key={c.key} className={`${rowClass} flex items-center gap-3 px-4 py-3`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${c.unread ? "bg-brand-600" : "bg-transparent"}`} aria-label={c.unread ? "Unread" : undefined} />
                <div className="min-w-0 flex-1">
                  <RowLink href={`/app/${slug}/inbox/${encodeURIComponent(c.key)}`} className={`block truncate ${c.unread ? "font-semibold" : "font-medium"}`}>{c.name}</RowLink>
                  <p className={`truncate text-sm ${c.unread ? "text-stone-800" : "text-stone-500"}`}>{c.lastDir === "out" ? "You: " : ""}{c.lastBody}</p>
                </div>
                <span className="w-28 shrink-0 text-right text-xs text-stone-500">{relative(c.lastAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
