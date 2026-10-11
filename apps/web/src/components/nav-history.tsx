"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const CUR = "nav:current";
const PREV = "nav:previous";

/** The in-app page before the current one, or null. Safe to call before NavHistory's own effect has run. */
export function previousPath(): string | null {
  try {
    const here = window.location.pathname;
    const cur = sessionStorage.getItem(CUR);
    // NavHistory runs after deeper components' effects: a stale "current" is the page we came from.
    if (cur && cur !== here) return cur;
    const prev = sessionStorage.getItem(PREV);
    return prev && prev !== here ? prev : null;
  } catch {
    return null;
  }
}

/**
 * Remembers the previous in-app page across client-side navigations (document.referrer does not
 * change on those), so BackLink can return to where the person actually came from. Renders nothing.
 */
export function NavHistory() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const cur = sessionStorage.getItem(CUR);
      if (cur && cur !== pathname) sessionStorage.setItem(PREV, cur);
      sessionStorage.setItem(CUR, pathname);
    } catch {
      /* storage blocked: BackLink falls back to its parent page */
    }
  }, [pathname]);
  return null;
}
