"use client";
import { useEffect } from "react";
import { markRead } from "./actions";

/** Marks the open conversation read once it is on screen (rendered only while something in it is unread). */
export function MarkReadOnOpen({ slug, convoKey }: { slug: string; convoKey: string }) {
  useEffect(() => {
    void markRead(slug, convoKey);
  }, [slug, convoKey]);
  return null;
}
