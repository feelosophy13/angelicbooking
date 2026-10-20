"use client";

declare global {
  interface Window {
    appendHelcimPayIframe?: (checkoutToken: string, allowExit?: boolean) => void;
    removeHelcimPayIframe?: () => void;
  }
}

let scriptLoading: Promise<void> | null = null;

/** Load Helcim's HelcimPay.js once (it draws Helcim's secure card form in an iframe over the page). */
export function loadHelcimPay(): Promise<void> {
  if (typeof window !== "undefined" && window.appendHelcimPayIframe) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://secure.helcim.app/helcim-pay/services/start.js";
    el.onload = () => resolve();
    el.onerror = () => { scriptLoading = null; reject(new Error("The card form could not load. Check the connection and try again.")); };
    document.head.appendChild(el);
  });
  return scriptLoading;
}

export type HelcimPayResult = { status: "SUCCESS"; message: unknown } | { status: "ABORTED"; message: unknown } | { status: "HIDE" };

/**
 * Open Helcim's card form for a checkout token and resolve with what happened: SUCCESS (its message goes to the server to be verified),
 * ABORTED (declined; the form stays open for another card, so this keeps listening), or HIDE (closed without paying).
 */
export function openHelcimPay(checkoutToken: string, onDeclined?: (message: unknown) => void): Promise<HelcimPayResult> {
  return new Promise((resolve, reject) => {
    loadHelcimPay().then(() => {
      const name = `helcim-pay-js-${checkoutToken}`;
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { eventName?: string; eventStatus?: string; eventMessage?: unknown } | null;
        if (!data || data.eventName !== name) return;
        if (data.eventStatus === "ABORTED") { onDeclined?.(data.eventMessage); return; }
        window.removeEventListener("message", onMessage);
        if (data.eventStatus === "SUCCESS") {
          window.removeHelcimPayIframe?.();
          resolve({ status: "SUCCESS", message: data.eventMessage });
        } else resolve({ status: "HIDE" });
      };
      window.addEventListener("message", onMessage);
      window.appendHelcimPayIframe?.(checkoutToken, true);
    }, reject);
  });
}
