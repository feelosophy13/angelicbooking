"use client";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const KEY = (businessId: string) => `cal_hidden_${businessId}`;

/**
 * Google Calendar's list of calendars with checkboxes, for providers: one chip per provider in the provider's colour. Click a chip to hide
 * that person (their column in Day, their blocks in the Week overview and Month); click again to bring them back. The hidden set travels
 * in `?hide=` so the server draws only what is shown, and it is remembered per business in this browser (localStorage) like the location
 * pills, so the calendar opens the way it was left. "Show all" appears only while someone is hidden.
 */
export function ProviderChips({ businessId, providers, hidden }: { businessId: string; providers: { id: string; name: string; color: string }[]; hidden: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const key = KEY(businessId);
  const withHide = (ids: string[]) => {
    const p = new URLSearchParams(Object.fromEntries(params.entries()));
    if (ids.length) p.set("hide", ids.join(","));
    else p.delete("hide");
    return `${pathname}?${p.toString()}`;
  };
  // Remember the choice; on a plain open (no `hide` in the address) come back to what was hidden last time.
  useEffect(() => {
    try {
      if (params.has("hide")) localStorage.setItem(key, params.get("hide") ?? "");
      else {
        const saved = localStorage.getItem(key);
        const ids = (saved ?? "").split(",").filter((id) => providers.some((p) => p.id === id));
        if (ids.length) router.replace(withHide(ids), { scroll: false });
      }
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, key]);
  const toggle = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
    try { localStorage.setItem(key, next.join(",")); } catch { /* storage unavailable */ }
    router.push(withHide(next), { scroll: false });
  };
  const showAll = () => {
    try { localStorage.setItem(key, ""); } catch { /* storage unavailable */ }
    router.push(withHide([]), { scroll: false });
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Providers shown">
      {providers.map((p) => {
        const off = hidden.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => toggle(p.id)}
            aria-pressed={!off}
            title={off ? `Show ${p.name}` : `Hide ${p.name}`}
            className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors", off ? "border-stone-200 bg-white text-stone-400 hover:text-stone-700" : "border-transparent text-stone-800 hover:bg-stone-100")}
            style={off ? undefined : { backgroundColor: `color-mix(in srgb, ${p.color} 18%, white)` }}
          >
            <span className={cn("flex h-3.5 w-3.5 items-center justify-center rounded-sm border", off ? "border-stone-300 bg-white" : "border-transparent")} style={off ? undefined : { backgroundColor: p.color }} aria-hidden>
              {off ? null : <Check className="h-3 w-3 text-white" strokeWidth={3} />}
            </span>
            {p.name}
          </button>
        );
      })}
      {hidden.length ? <button type="button" onClick={showAll} className="ml-1 text-xs text-brand-700 underline">Show all</button> : null}
    </div>
  );
}
