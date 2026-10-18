"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the open thread current: scrolls to the newest text when it renders, and re-renders
 * the page every 20 seconds while the tab is in front, so a reply from the client and the
 * delivery receipt of a text just sent both appear on their own.
 */
export function ThreadLive({ lastId }: { /** The newest text's id: a change scrolls to it; a quiet refresh leaves the scroll where the reader put it. */ lastId: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const el = document.querySelector<HTMLElement>("[data-thread]");
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && router.refresh(), 20_000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
