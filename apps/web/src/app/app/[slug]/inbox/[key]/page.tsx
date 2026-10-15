import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { can } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { clientThread, numberThread, unreadFor } from "@/server/inbound";
import { MarkRead } from "./mark-read";
import { ReplyBox } from "./reply-box";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ slug: string; key: string }> }) {
  const { slug, key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const { business, permissions } = await requireAction(slug, "clients.read");
  const write = can(permissions, "clients.write");
  const isNumber = key.startsWith("tel:");
  const client = isNumber ? null : await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, key) }));
  if (!isNumber && !client) notFound();
  const unread = (await unreadFor(business.id, key)) > 0;
  const thread = client ? await clientThread(business.id, client.id, 200) : await numberThread(business.id, key.slice(4), 200);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });
  const name = client ? `${client.firstName} ${client.lastName}`.trim() : key.slice(4);
  return (
    <>
      <MarkRead slug={slug} convoKey={key} unread={unread} />
      <BackLink href={`/app/${slug}/inbox`}>Inbox</BackLink>
      <PageHeader title={name}>
        {client ? <Link href={`/app/${slug}/clients/${client.id}`} className="text-sm text-brand-700 hover:underline">Client page</Link> : null}
      </PageHeader>
      <Card className="p-4">
        {thread.length === 0 ? <p className="text-sm text-stone-500">No texts yet.</p> : (
          <ul className="space-y-2">
            {thread.map((m) => (
              <li key={`${m.dir}${m.id}`} className={m.dir === "in" ? "mr-12" : "ml-12 text-right"}>
                <span className={`inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm ${m.dir === "in" ? "bg-stone-100 text-stone-800" : "bg-brand-50 text-brand-900"}`}>{m.body}</span>
                <span className="block text-xs text-stone-400">{fmt.format(m.at)}{m.dir === "out" ? ` · ${m.status}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 border-t border-stone-100 pt-4">
          {client && write && client.phone ? <ReplyBox slug={slug} clientId={client.id} optedOut={!client.smsOptIn} />
            : <p className="text-sm text-stone-500">{!client ? "This number is not on a client record, so you can't reply from here. Add them as a client to text back." : write ? "This client has no mobile number." : "You can read texts but not send them."}</p>}
        </div>
      </Card>
    </>
  );
}
