"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Card, Empty, Input } from "@/components/ui";
import { rowClass, RowLink } from "@/components/row";
import { CONVERSATION_FILTERS, needsReply, whenShort, type ConversationFilter } from "@/lib/inbox";
import { cn } from "@/lib/utils";

export type ListItem = { key: string; clientId: string | null; name: string; phone: string; smsOptIn: boolean; lastBody: string; lastAt: string; lastDir: "in" | "out"; lastFailed: boolean; unread: number; nextAt: string | null };
type Feed = { items: ListItem[]; total: number; unread: number };

const PAGE = 50;

/**
 * Every text conversation, unread first. Search and the filter run against the feed route
 * and the list asks again every half minute (and when a conversation is opened, since that
 * marks it read), so what the desk sees is live without a reload. ↑ ↓ or J K open the next
 * or previous conversation; / jumps to the search box.
 */
export function ConversationList({ slug, timeZone, initial }: { slug: string; timeZone: string; initial: Feed }) {
  const router = useRouter();
  const path = usePathname();
  const base = `/app/${slug}/inbox`;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [feed, setFeed] = useState<Feed>(initial);
  const search = useRef<HTMLInputElement>(null);
  const openKey = path.startsWith(`${base}/`) ? decodeURIComponent(path.slice(base.length + 1)) : null;

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${base}/feed?${new URLSearchParams({ q, f: filter, n: String(limit) })}`, { cache: "no-store" });
      if (r.ok) setFeed((await r.json()) as Feed);
    } catch {
      /* offline: keep what we had */
    }
  }, [base, q, filter, limit]);

  // Search and filter: a short pause after typing, then ask. The first render uses what the server sent.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  // Opening a conversation marks it read a moment later; a send or a mark-unread re-renders the layout (new `initial`); a new text arrives whenever it likes.
  useEffect(() => {
    const t = setTimeout(load, 800);
    const every = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    const onShow = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(t);
      clearInterval(every);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load, path, initial]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.key === "Escape" && typing) return el?.blur();
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        return search.current?.focus();
      }
      const step = e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
      if (!step || !feed.items.length) return;
      e.preventDefault();
      const i = feed.items.findIndex((c) => c.key === openKey);
      const next = feed.items[i < 0 ? (step > 0 ? 0 : feed.items.length - 1) : Math.min(feed.items.length - 1, Math.max(0, i + step))];
      if (next && next.key !== openKey) router.push(`${base}/${encodeURIComponent(next.key)}`);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [feed.items, openKey, base, router]);

  return (
    <div className="space-y-3">
      <Input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or message" aria-label="Search conversations" autoComplete="off" />
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter conversations">
        {CONVERSATION_FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)} className={cn("rounded-full px-3 py-1 text-xs font-medium", filter === f.key ? "bg-stone-800 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-200 hover:bg-stone-50")}>
            {f.label}{f.key === "unread" && feed.unread ? ` ${feed.unread}` : ""}
          </button>
        ))}
      </div>
      {feed.items.length === 0 ? (
        q || filter !== "all" ? <Empty title="No conversations match" body={q ? "Try another name, number or word." : "Nothing here right now."} /> : <Empty title="No conversations yet" body="When a client texts your number, the conversation appears here. You can reply from the same place." />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {feed.items.map((c) => {
              const active = c.key === openKey;
              const at = new Date(c.lastAt);
              return (
                <li key={c.key} className={cn(rowClass, "flex items-start gap-3 px-3 py-2.5", active && "bg-brand-50/70 hover:bg-brand-50/70")} aria-current={active ? "page" : undefined}>
                  <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", c.unread ? "bg-brand-600" : "bg-transparent")} aria-label={c.unread ? "Unread" : undefined} />
                  <div className="min-w-0 flex-1">
                    <RowLink href={`${base}/${encodeURIComponent(c.key)}`} className={cn("block truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>
                      {c.name}
                      {c.clientId ? null : <span className="ml-2 text-xs font-normal text-stone-500">not a client</span>}
                      {c.smsOptIn ? null : <span className="ml-2 text-xs font-normal text-red-700">opted out</span>}
                    </RowLink>
                    <p className={cn("truncate text-sm", c.unread ? "text-stone-800" : "text-stone-500")}>
                      {c.lastDir === "out" ? "You: " : ""}{c.lastBody || "Picture"}
                      {c.lastFailed ? <span className="ml-2 text-red-700">· not sent</span> : null}
                    </p>
                  </div>
                  <div className="w-20 shrink-0 text-right text-xs text-stone-500">
                    <p className={cn(c.unread && "font-medium text-stone-800")}>{whenShort(at, timeZone)}</p>
                    {c.nextAt ? <p className="truncate text-brand-700" title="Next appointment">Next {whenShort(new Date(c.nextAt), timeZone)}</p> : needsReply(c) && !c.unread ? <p className="text-stone-400">needs reply</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {feed.total > feed.items.length ? (
            <div className="border-t border-stone-100 px-4 py-2 text-center">
              <Button type="button" variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE)}>Show more ({feed.total - feed.items.length} older)</Button>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}
