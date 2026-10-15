"use client";
import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * A filter form with no Apply button: changing any control in it loads the page again with the new choice in the
 * address (blank values are left out, so addresses stay short). Without JavaScript the form still submits normally
 * when the visitor presses Enter. Use it for single-choice filters; pages with text boxes keep an explicit Apply.
 */
export function AutoSubmitForm({ children, className }: { children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  // A native listener, so custom pickers that set a hidden input and dispatch "change" are heard too.
  useEffect(() => {
    const el = form.current;
    if (!el) return;
    const onChange = (e: Event) => {
      // A form nested inside (the client picker's "New client") is not a filter: typing there must not reload the page.
      if ((e.target as HTMLElement | null)?.closest?.("form") !== el) return;
      const params = new URLSearchParams();
      for (const [k, v] of new FormData(el)) if (typeof v === "string" && v) params.set(k, v);
      const qs = params.toString();
      start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
    };
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [router, pathname]);
  return (
    <form ref={form} method="get" aria-busy={pending} className={cn(pending && "opacity-70 transition-opacity", className)}>
      {children}
    </form>
  );
}
