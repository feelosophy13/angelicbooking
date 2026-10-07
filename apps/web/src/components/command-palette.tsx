"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Search, UserRound, Scissors, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Hit = { kind: "client" | "appointment" | "service" | "page"; title: string; subtitle?: string; href: string };

/** ⌘K / Ctrl+K search across clients, upcoming appointments, services and pages. */
export function CommandPalette({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 10);
    else {
      setQ("");
      setHits([]);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/app/${slug}/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (r.ok) {
          setHits((await r.json()).hits);
          setActive(0);
        }
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, slug]);

  const go = (h: Hit) => {
    setOpen(false);
    router.push(h.href);
  };
  const Icon = ({ kind }: { kind: Hit["kind"] }) => (kind === "client" ? <UserRound className="h-4 w-4 text-stone-400" /> : kind === "appointment" ? <CalendarDays className="h-4 w-4 text-stone-400" /> : kind === "service" ? <Scissors className="h-4 w-4 text-stone-400" /> : <ArrowRight className="h-4 w-4 text-stone-400" />);

  return (
    <>
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-left text-sm text-stone-500 hover:bg-stone-100">
        <Search className="h-4 w-4" />
        <span className="flex-1">Search…</span>
        <kbd className="rounded border border-stone-300 bg-white px-1 text-[10px] text-stone-500">⌘K</kbd>
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-stone-900/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div role="dialog" aria-label="Search" className="w-full max-w-lg overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-stone-200 px-3">
              <Search className="h-4 w-4 text-stone-400" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(hits.length - 1, a + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === "Enter" && hits[active]) go(hits[active]!);
                }}
                placeholder="Clients, appointments, services, pages…"
                className="h-12 flex-1 bg-transparent text-sm outline-none"
              />
              {loading ? <span className="text-xs text-stone-400">…</span> : null}
            </div>
            <ul className="max-h-80 overflow-y-auto py-1">
              {hits.length === 0 ? <li className="px-4 py-6 text-center text-sm text-stone-500">{q ? "No matches" : "Type to search, or pick a page below"}</li> : null}
              {hits.map((h, i) => (
                <li key={`${h.kind}:${h.href}`}>
                  <button onMouseEnter={() => setActive(i)} onClick={() => go(h)} className={cn("flex w-full items-center gap-3 px-4 py-2 text-left text-sm", i === active && "bg-brand-50")}>
                    <Icon kind={h.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{h.title}</span>
                      {h.subtitle ? <span className="block truncate text-xs text-stone-500">{h.subtitle}</span> : null}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-stone-400">{h.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
