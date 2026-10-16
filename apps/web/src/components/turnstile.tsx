"use client";
import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; "expired-callback": () => void; "error-callback": () => void; appearance?: "always" | "interaction-only" }) => string;
      remove: (id: string) => void;
      reset: (id: string) => void;
    };
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * The Cloudflare bot check. Calls `onToken` with a token when passed (and with null when it expires). A token works once: change
 * `resetKey` after each submit to get a fresh one. `quiet` shows nothing unless Cloudflare needs the visitor to tick the box.
 */
export function Turnstile({ siteKey, onToken, resetKey, quiet = false }: { siteKey: string; onToken: (token: string | null) => void; resetKey?: unknown; quiet?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (resetKey === undefined || !widget.current || !window.turnstile) return;
    onToken(null);
    window.turnstile.reset(widget.current);
  }, [resetKey, onToken]);
  useEffect(() => {
    let id: string | undefined;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !box.current || !window.turnstile || id) return;
      id = window.turnstile.render(box.current, { sitekey: siteKey, callback: (t) => onToken(t), "expired-callback": () => onToken(null), "error-callback": () => onToken(null), ...(quiet ? { appearance: "interaction-only" as const } : {}) });
      widget.current = id;
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
      widget.current = undefined;
    };
  }, [siteKey, onToken, quiet]);
  return <div ref={box} className={quiet ? "flex justify-center" : "flex min-h-[65px] justify-center"} />;
}

/**
 * The bot check inside a public form: renders the widget (quietly); Cloudflare puts its token in a hidden `cf-turnstile-response` field in
 * the form. Shows nothing when Turnstile isn't configured or on a host it isn't registered for (a business's own booking domain).
 */
export function PublicBotCheck({ resetKey }: { resetKey?: unknown }) {
  const [on, setOn] = useState(false);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  useEffect(() => {
    const hosts = (process.env.NEXT_PUBLIC_TURNSTILE_HOSTNAMES ?? "app.angelicbooking.com,localhost").split(",").map((h) => h.trim().toLowerCase());
    setOn(!!siteKey && hosts.includes(window.location.hostname.toLowerCase()));
  }, [siteKey]);
  const onToken = useCallback(() => {}, []);
  if (!on || !siteKey) return null;
  return <Turnstile siteKey={siteKey} onToken={onToken} resetKey={resetKey} quiet />;
}
