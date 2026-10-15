"use client";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string; remove: (id: string) => void };
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The Cloudflare bot check. Calls `onToken` with a token when passed (and with null when it expires). */
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id: string | undefined;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !box.current || !window.turnstile || id) return;
      id = window.turnstile.render(box.current, { sitekey: siteKey, callback: (t) => onToken(t), "expired-callback": () => onToken(null), "error-callback": () => onToken(null) });
    };
    if (window.turnstile) mount();
    else {
      let s = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
      if (!s) {
        s = document.createElement("script");
        s.src = SRC;
        s.async = true;
        document.head.appendChild(s);
      }
      s.addEventListener("load", mount);
    }
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, onToken]);
  return <div ref={box} className="flex min-h-[65px] justify-center" />;
}
