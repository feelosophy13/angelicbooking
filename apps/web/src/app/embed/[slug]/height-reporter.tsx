"use client";
import { useEffect } from "react";

/** Tells the embedding page (embed.js) how tall the booking flow is so the iframe never scrolls inside. */
export function HeightReporter() {
  useEffect(() => {
    if (window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "angelic:height", height: document.documentElement.scrollHeight }, "*");
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    const t = setInterval(send, 1000);
    return () => {
      ro.disconnect();
      clearInterval(t);
    };
  }, []);
  return null;
}
