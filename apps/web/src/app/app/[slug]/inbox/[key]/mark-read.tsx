"use client";
import { useEffect } from "react";
import { markRead } from "./actions";

/** Marks the open conversation read once it is on screen (a no-op when nothing is unread). */
export function MarkRead({ slug, convoKey, unread }: { slug: string; convoKey: string; unread: boolean }) {
  useEffect(() => {
    if (unread) void markRead(slug, convoKey);
  }, [slug, convoKey, unread]);
  return null;
}
