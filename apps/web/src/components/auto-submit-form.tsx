"use client";
import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/** How long typing in a search box has to pause before the list follows it. */
const TYPING_PAUSE_MS = 300;

/**
 * A filter form with no Apply button: changing any control in it loads the page again with the new choice in the
 * address (blank values are left out, so addresses stay short). Selects, switches and pickers apply the moment they
 * change; a date applies once it is a whole date; a text box applies when typing pauses or on Enter, replacing the
 * address instead of adding a back-button step per letter. When the address changes some other way (a Clear link, the
 * back button, a location pill) the controls are set from it so they show what the list shows. Without JavaScript the
 * form still submits normally when the visitor presses Enter.
 */
export function AutoSubmitForm({ children, className }: { children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  // Addresses this form asked for that have not landed yet, oldest first (an earlier search can land after a later one
  // was asked for). Any other address (Clear, back, a location pill) is copied into the boxes, which otherwise keep
  // what was typed before: their defaultValue only counts on first render. Pickers follow their `value` prop already.
  // Read from the address after each render rather than useSearchParams, which would need a Suspense boundary.
  const asked = useRef<string[]>([]);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const el = form.current;
    const query = window.location.search.replace(/^\?/, "");
    if (!el || query === shown.current) return;
    const first = shown.current === null;
    shown.current = query;
    const at = asked.current.indexOf(query);
    if (at >= 0) {
      asked.current = asked.current.slice(at + 1);
      return;
    }
    asked.current = [];
    if (first) return;
    const params = new URLSearchParams(query);
    for (const c of Array.from(el.elements)) {
      if (c.closest("form") !== el || c === document.activeElement || !("name" in c) || !c.name) continue;
      if (c instanceof HTMLInputElement) {
        if (c.type === "hidden" || c.type === "submit" || c.type === "button") continue;
        if (c.type === "checkbox" || c.type === "radio") c.checked = params.getAll(c.name).includes(c.value);
        else c.value = params.get(c.name) ?? "";
      } else if (c instanceof HTMLSelectElement) {
        c.value = params.get(c.name) ?? "";
        if (c.selectedIndex === -1) c.selectedIndex = 0;
      }
    }
  });
  // A native listener, so custom pickers that set a hidden input and dispatch "change" are heard too.
  useEffect(() => {
    const el = form.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = (replace: boolean) => {
      clearTimeout(timer);
      const params = new URLSearchParams();
      for (const [k, v] of new FormData(el)) if (typeof v === "string" && v) params.set(k, v);
      const qs = params.toString();
      if (qs === window.location.search.replace(/^\?/, "")) return;
      asked.current.push(qs);
      const url = qs ? `${pathname}?${qs}` : pathname;
      start(() => (replace ? router.replace(url, { scroll: false }) : router.push(url)));
    };
    // A form nested inside (the client picker's "New client") is not a filter: typing there must not reload the page.
    const ours = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.("form") === el;
    const isText = (t: EventTarget | null) =>
      t instanceof HTMLInputElement && (t.type === "text" || t.type === "search");
    // While a year is still being typed the browser reports dates like 0002-10-18; wait for a real one.
    const halfDate = (t: EventTarget | null) =>
      t instanceof HTMLInputElement && t.type === "date" && t.value !== "" && Number(t.value.slice(0, 4)) < 1900;
    const onChange = (e: Event) => {
      if (!ours(e.target) || halfDate(e.target)) return;
      go(false);
    };
    const onInput = (e: Event) => {
      if (!ours(e.target) || !isText(e.target)) return;
      clearTimeout(timer);
      timer = setTimeout(() => go(true), TYPING_PAUSE_MS);
    };
    const onSubmit = (e: SubmitEvent) => {
      if (e.target !== el) return;
      e.preventDefault();
      go(false);
    };
    el.addEventListener("change", onChange);
    el.addEventListener("input", onInput);
    el.addEventListener("submit", onSubmit);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("change", onChange);
      el.removeEventListener("input", onInput);
      el.removeEventListener("submit", onSubmit);
    };
  }, [router, pathname]);
  return (
    <form ref={form} method="get" aria-busy={pending} className={cn(pending && "opacity-70 transition-opacity", className)}>
      {children}
    </form>
  );
}
