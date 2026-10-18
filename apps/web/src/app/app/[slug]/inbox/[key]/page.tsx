import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { can } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { BackLink, Button, Card } from "@/components/ui";
import { automatedLabel, deliveryLabel, groupByDay } from "@/lib/inbox";
import { dateTime, time } from "@/lib/format";
import { quickRepliesFor } from "@/lib/notify/quick-replies";
import { clientThread, conversationContext, numberThread, unreadFor } from "@/server/inbound";
import { isSmsSuppressed } from "@/server/consent";
import { smsAvailableFor } from "@/server/messaging";
import { AddClient } from "./add-client";
import { markUnread, retryText } from "./actions";
import { MarkReadOnOpen } from "./mark-read";
import { ReplyBox } from "./reply-box";
import { ThreadLive } from "./thread-live";

export const metadata: Metadata = { title: "Conversation" };

/**
 * One conversation as a chat: oldest at the top, newest at the bottom, the composer pinned
 * under it. Above the thread, what the desk needs to answer: the client's number, next visit
 * and last visit, with links to the client and to book. Automated texts sit in the thread
 * with a small label, so staff see exactly what the client saw.
 */
export default async function ConversationPage({ params }: { params: Promise<{ slug: string; key: string }> }) {
  const { slug, key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const { business, permissions } = await requireAction(slug, "clients.messages");
  // Reading texts is one permission; answering them also needs the one for editing clients.
  const write = can(permissions, "clients.write");
  const isNumber = key.startsWith("tel:");
  const client = isNumber ? null : await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, key) }));
  if (!isNumber && !client) notFound();
  const tz = business.timezone;
  const [unread, thread, context, smsReady, stopped] = await Promise.all([
    unreadFor(business.id, key),
    client ? clientThread(business.id, client.id, 200) : numberThread(business.id, key.slice(4), 200),
    client ? conversationContext(business.id, client.id) : Promise.resolve(null),
    write ? smsAvailableFor(business.id) : Promise.resolve(false),
    client?.phone ? withTenant(business.id, (tx) => isSmsSuppressed(tx, client.phone)) : Promise.resolve(false),
  ]);
  const name = client ? `${client.firstName} ${client.lastName}`.trim() : key.slice(4);
  const canText = !!client && write && !!client.phone && client.smsOptIn && !stopped && smsReady;
  const canBook = !!client && can(permissions, "appointments.write.any");
  const hasInbound = thread.some((m) => m.dir === "in");
  const next = context?.next ? { when: dateTime(context.next.startAt, tz), service: context.next.service, staff: context.next.staff ?? "us" } : null;
  // One line, never a form: why the desk cannot write back from here.
  const why = !client ? null
    : !write ? "You can read texts but not send them."
    : !client.phone ? "This client has no mobile number."
    : stopped ? "This number replied STOP, so nothing can be sent to it."
    : !client.smsOptIn ? "This client has opted out of texts."
    : !smsReady ? "Replies need a verified text number."
    : null;
  return (
    <>
      <ThreadLive lastId={thread[thread.length - 1]?.id ?? null} />
      <div className="mb-3 lg:hidden"><BackLink href={`/app/${slug}/inbox`}>Inbox</BackLink></div>
      <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{name}</h2>
          <p className="text-sm text-stone-500">
            {client ? (client.phone ?? "No mobile number") : "Not a client"}
            {client && !client.smsOptIn ? <span className="ml-2 text-red-700">opted out</span> : null}
            {client && context ? (
              <>
                {" · "}
                {context.next ? <Link href={`/app/${slug}/appointments/${context.next.id}`} className="hover:underline">Next: {dateTime(context.next.startAt, tz)} · {context.next.service}{context.next.staff ? ` with ${context.next.staff}` : ""}</Link> : "No upcoming visit"}
                {context.last ? <> · <Link href={`/app/${slug}/appointments/${context.last.id}`} className="hover:underline">Last visit {dateTime(context.last.startAt, tz).replace(/,? \d{1,2}:\d{2} [AP]M$/, "")} · {context.last.service}</Link></> : null}
                {context.completed > 1 ? ` · ${context.completed} visits` : null}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {client ? <Link href={`/app/${slug}/clients/${client.id}`} className="rounded-lg px-2 py-1 text-sm text-stone-700 hover:bg-stone-100">Client page</Link> : null}
          {canBook ? <Link href={`/app/${slug}/appointments/new?clientId=${client!.id}`} className="rounded-lg px-2 py-1 text-sm text-stone-700 hover:bg-stone-100">Book</Link> : null}
          {hasInbound ? (
            <form action={markUnread}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="key" value={key} />
              <Button type="submit" variant="ghost" size="sm" title="Put it back in the unread pile">Mark unread</Button>
            </form>
          ) : null}
        </div>
      </div>
      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="max-h-[60vh] min-h-48 flex-1 overflow-y-auto px-4 py-3 lg:max-h-none" data-thread>
          {thread.length === 0 ? <p className="py-6 text-center text-sm text-stone-500">No texts yet.</p> : groupByDay(thread, tz).map((day) => (
            <div key={day.label}>
              <p className="my-3 text-center text-[11px] font-medium uppercase tracking-wide text-stone-400">{day.label}</p>
              <ul className="space-y-2">
                {day.items.map((m) => {
                  const auto = m.dir === "out" && m.template ? automatedLabel(m.template) : null;
                  const state = m.dir === "out" ? deliveryLabel(m) : null;
                  return (
                    <li key={`${m.dir}${m.id}`} className={m.dir === "in" ? "mr-10 sm:mr-24" : "ml-10 text-right sm:ml-24"}>
                      {m.media.map((a) => (
                        <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="mb-1 inline-block">
                          {a.type.startsWith("image/") ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={a.url} alt={m.dir === "in" ? "Picture sent by the client" : "Picture sent to the client"} className="max-h-64 rounded-lg" /> : <span className="text-sm text-brand-700 underline">Open attachment ({a.type || "file"})</span>}
                        </a>
                      ))}
                      {m.body ? <span className={`inline-block max-w-full whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-sm ${m.dir === "in" ? "bg-stone-100 text-stone-800" : "bg-brand-600 text-white"}`}>{m.body}</span> : null}
                      <span className="mt-0.5 block text-[11px] text-stone-400">
                        {auto ? <span className="mr-1 rounded bg-stone-100 px-1 text-stone-500">{auto}</span> : null}
                        {time(m.at, tz)}
                        {state ? <span className={{ muted: " text-stone-400", ok: " text-emerald-700", bad: " text-red-700", wait: " text-amber-700" }[state.tone]}> · {state.text}</span> : null}
                        {state?.retry && canText ? (
                          <form action={retryText} className="ml-1.5 inline">
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="clientId" value={client!.id} />
                            <input type="hidden" name="id" value={m.id} />
                            <button type="submit" className="text-brand-700 hover:underline">Send again</button>
                          </form>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <div className="sticky bottom-16 shrink-0 rounded-b-xl border-t border-stone-100 bg-white px-4 py-3 md:bottom-0 lg:static">
          {!client ? (write ? <AddClient slug={slug} number={key.slice(4)} /> : <p className="text-sm text-stone-500">This number is not on a client record.</p>)
            : why ? <p className="text-sm text-stone-500">{why}{why.startsWith("Replies need") && can(permissions, "business.manage") ? <> <Link href={`/app/${slug}/settings/messaging`} className="underline">Settings → Text number</Link></> : null}</p>
            : <ReplyBox slug={slug} clientId={client.id} quickReplies={quickRepliesFor(business)} context={{ firstName: client.firstName, business: business.name, next }} />}
        </div>
      </Card>
      {unread > 0 ? <MarkReadOnOpen slug={slug} convoKey={key} /> : null}
    </>
  );
}
