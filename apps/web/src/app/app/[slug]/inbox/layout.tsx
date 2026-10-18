import Link from "next/link";
import { can } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { LinkButton, PageHeader } from "@/components/ui";
import { listConversations } from "@/server/inbound";
import { smsAvailableFor } from "@/server/messaging";
import { ConversationList } from "./conversation-list";
import { InboxShell } from "./inbox-shell";

/**
 * The inbox is two panes on a desktop (the conversation list, then the open conversation)
 * and two pages on a phone. The list lives here so switching conversations never reloads it.
 */
export default async function InboxLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireAction(slug, "clients.messages");
  const write = can(permissions, "clients.write");
  const [initial, smsReady] = await Promise.all([listConversations(business.id, { limit: 50 }), write ? smsAvailableFor(business.id) : Promise.resolve(false)]);
  const header = (
    <PageHeader title="Inbox">
      {write && smsReady ? <LinkButton href={`/app/${slug}/inbox/new`} variant="primary">New message</LinkButton> : null}
    </PageHeader>
  );
  // No verified number: the desk can read what came in but not answer; one line says why (and where to fix it, for the owner).
  const notice = write && !smsReady ? (
    <p className="mb-3 text-sm text-stone-500">
      Texts can be read but not sent until a text number is verified.{can(permissions, "business.manage") ? <> <Link href={`/app/${slug}/settings/messaging`} className="underline">Settings → Text number</Link></> : null}
    </p>
  ) : null;
  return (
    <InboxShell base={`/app/${slug}/inbox`} header={header} notice={notice} list={<ConversationList slug={slug} timeZone={business.timezone} initial={{ items: initial.items.map((c) => ({ ...c, lastAt: c.lastAt.toISOString(), nextAt: c.nextAt?.toISOString() ?? null })), total: initial.total, unread: initial.unread }} />}>
      {children}
    </InboxShell>
  );
}
