import type { Metadata } from "next";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { Card, Empty, Input, PageHeader } from "@/components/ui";
import { rowClass, RowLink } from "@/components/row";
import { relative } from "@/lib/format";
import { listConversations } from "@/server/inbound";

export const metadata: Metadata = { title: "Inbox" };

const PAGE = 50;

/** Every text conversation with clients, newest first. Search by name, number or words in the last text; open one to read it and reply. */
export default async function InboxPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; n?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "clients.read");
  const q = (sp.q ?? "").trim();
  const limit = Math.min(Math.max(Number(sp.n) || PAGE, PAGE), 1000);
  const { items, total } = await listConversations(business.id, { q, limit });
  const unread = items.reduce((n, c) => n + c.unread, 0);
  const more = (n: number) => `/app/${slug}/inbox?${new URLSearchParams({ ...(q ? { q } : {}), n: String(n) })}`;
  return (
    <>
      <PageHeader title={unread ? `Inbox (${unread} unread)` : "Inbox"} />
      <form method="get" className="mb-4">
        <Input name="q" defaultValue={q} placeholder="Search name, number or message" aria-label="Search conversations" />
      </form>
      {items.length === 0 ? (
        q ? <Empty title="No matches" body="No conversation matches that search." /> : <Empty title="No conversations yet" body="When a client texts your number, the conversation appears here. You can reply from the same place." />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {items.map((c) => (
              <li key={c.key} className={`${rowClass} flex items-center gap-3 px-4 py-3`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${c.unread ? "bg-brand-600" : "bg-transparent"}`} aria-label={c.unread ? "Unread" : undefined} />
                <div className="min-w-0 flex-1">
                  <RowLink href={`/app/${slug}/inbox/${encodeURIComponent(c.key)}`} className={`block truncate ${c.unread ? "font-semibold" : "font-medium"}`}>
                    {c.name}
                    {c.clientId ? null : <span className="ml-2 text-xs font-normal text-stone-500">not a client</span>}
                    {c.smsOptIn ? null : <span className="ml-2 text-xs font-normal text-red-700">opted out</span>}
                  </RowLink>
                  <p className={`truncate text-sm ${c.unread ? "text-stone-800" : "text-stone-500"}`}>
                    {c.lastDir === "out" ? "You: " : ""}{c.lastBody}
                    {c.lastFailed ? <span className="ml-2 text-red-700">· not delivered</span> : null}
                  </p>
                </div>
                <span className="w-28 shrink-0 text-right text-xs text-stone-500">{relative(c.lastAt)}</span>
              </li>
            ))}
          </ul>
          {total > items.length ? (
            <div className="border-t border-stone-100 px-4 py-3 text-center text-sm">
              <Link href={more(limit + PAGE)} className="text-brand-700 hover:underline">Show more ({total - items.length} older)</Link>
            </div>
          ) : null}
        </Card>
      )}
    </>
  );
}
