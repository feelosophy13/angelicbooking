"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { LegalFooter } from "@/components/doc-page";

type Item = { id: string; text: string; group?: boolean };

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Layout for the API reference: a sticky section list that follows the reader, a search box that filters the endpoints, and a jump menu on
 * phones. The sections are plain server-rendered headings and <Endpoint>s; this reads them from the page once it loads, so a new section
 * appears in the list without being registered anywhere.
 */
export function DocsShell({ children, updated }: { children: React.ReactNode; updated: string }) {
  const body = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState("");
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<{ total: number; shown: number; sections: Set<string> } | null>(null);

  // Find the sections and give each a stable id.
  useEffect(() => {
    const heads = [...(body.current?.querySelectorAll<HTMLElement>(":scope > h1[data-group], :scope > h2") ?? [])];
    const used = new Set<string>();
    setItems(
      heads.map((h) => {
        let id = h.id || slugify(h.textContent ?? "section");
        while (used.has(id)) id += "-2";
        used.add(id);
        h.id = id;
        h.classList.add("scroll-mt-20");
        return { id, text: h.textContent ?? "", group: h.tagName === "H1" };
      }),
    );
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, []);

  // Highlight the section being read.
  useEffect(() => {
    if (!items.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    items.forEach((i) => { const el = document.getElementById(i.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [items]);

  // Search: while a query is typed show only matching endpoints under their headings.
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    const kids = [...root.children] as HTMLElement[];
    const needle = q.trim().toLowerCase();
    if (!needle) {
      kids.forEach((k) => (k.style.display = ""));
      setMatches(null);
      return;
    }
    const words = needle.split(/\s+/);
    let total = 0;
    let shown = 0;
    const sections = new Set<string>();
    let head: HTMLElement | null = null;
    let headHasHit = false;
    const closeHead = () => {
      if (head) {
        head.style.display = headHasHit ? "" : "none";
        if (headHasHit) sections.add(head.id);
      }
    };
    for (const k of kids) {
      if (k.tagName === "H1" || k.tagName === "H2") {
        closeHead();
        head = k;
        headHasHit = false;
        continue;
      }
      if (k.hasAttribute("data-endpoint")) {
        total++;
        const text = (k.textContent ?? "").toLowerCase();
        const hit = words.every((w) => text.includes(w));
        k.style.display = hit ? "" : "none";
        if (hit) { shown++; headHasHit = true; }
      } else {
        k.style.display = "none";
      }
    }
    closeHead();
    setMatches({ total, shown, sections });
  }, [q]);

  // While searching keep only sections with hits; a group label stays only when something under it does.
  const kept = matches ? items.filter((i) => i.group || matches.sections.has(i.id)) : items;
  const visible = kept.filter((it, n) => !it.group || (kept[n + 1] && !kept[n + 1]!.group));

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="hit"><Wordmark /></Link>
            <span className="hidden rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600 sm:inline">API reference</span>
          </div>
          <nav className="flex gap-4 text-sm text-stone-600">
            <Link href="/help" className="hit hover:text-stone-900">Help</Link>
            <Link href="/sign-in" className="hit hover:text-stone-900">Sign in</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-stone-400" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search endpoints (clients, POST, forms:write)"
              aria-label="Search endpoints"
              className="h-9 w-full rounded-lg border border-stone-300 bg-white pl-8 pr-2 text-sm placeholder:text-stone-400 focus-visible:outline-2 focus-visible:outline-brand-500"
            />
          </div>
          {matches ? <p className="mt-2 text-xs text-stone-500">{matches.shown} of {matches.total} endpoints</p> : null}
          {/* Phones: one jump menu instead of a long list */}
          <select
            aria-label="Jump to section"
            className="mt-3 h-9 w-full rounded-lg border border-stone-300 bg-white px-2 text-sm lg:hidden"
            value={active}
            onChange={(e) => { location.hash = e.target.value; }}
          >
            {visible.map((i) => <option key={i.id} value={i.id}>{i.group ? `— ${i.text}` : i.text}</option>)}
          </select>
          <ul className="mt-3 hidden space-y-0.5 text-sm lg:block">
            {visible.map((i) => i.group ? (
              <li key={i.id} className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                <a href={`#${i.id}`} className="hover:text-stone-600">{i.text}</a>
              </li>
            ) : (
              <li key={i.id}>
                <a
                  href={`#${i.id}`}
                  aria-current={active === i.id ? "location" : undefined}
                  className={`block rounded-md px-2 py-1 ${active === i.id ? "bg-brand-50 font-medium text-brand-700" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}
                >
                  {i.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>

        <main className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">API documentation</h1>
          <p className="mt-1 text-sm text-stone-500">Last updated {updated}</p>
          <div
            ref={body}
            className="mt-6 max-w-4xl space-y-4 text-[15px] leading-relaxed text-stone-800 [&_h1]:text-2xl [&_h2]:mt-10 [&_h2]:border-t [&_h2]:border-stone-200 [&_h2]:pt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_a]:text-brand-700 [&_a]:underline [&_p_code]:rounded [&_p_code]:bg-stone-100 [&_p_code]:px-1 [&_p_code]:py-0.5 [&_p_code]:text-[13px] [&_li_code]:rounded [&_li_code]:bg-stone-100 [&_li_code]:px-1 [&_li_code]:text-[13px] [&_td_code]:text-[13px] [&_table]:text-sm"
          >
            {children}
          </div>
          {matches && matches.shown === 0 ? <p className="mt-8 rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">No endpoints match “{q}”. Try a resource (clients), a method (DELETE) or a scope (inventory:write).</p> : null}
        </main>
      </div>
      <LegalFooter className="!max-w-7xl" />
    </div>
  );
}
