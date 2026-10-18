/**
 * Send a failure to ERROR_WEBHOOK_URL (Slack/Discord-compatible JSON) when it is set, and always to the log. Used by Next's request-error
 * hook, by the REST API (which answers its own 500s, so Next never sees them) and by the background jobs (which carry on past a failing
 * step). With no webhook, the same summary goes by email to ERROR_EMAIL_TO (default SUPPORT_EMAIL) when email is configured, throttled so a
 * crash loop sends a handful of emails, not hundreds. Never throws.
 */
export async function reportError(summary: string, err?: unknown, extra: Record<string, unknown> = {}) {
  const e = err as { message?: string; stack?: string; digest?: string } | undefined;
  console.error("[error]", summary, e?.stack ?? e?.message ?? "");
  const payload = {
    text: `:rotating_light: ${summary}`,
    app: "angelic-booking",
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    digest: e?.digest,
    stack: e?.stack?.split("\n").slice(0, 8).join("\n"),
    at: new Date().toISOString(),
    ...extra,
  };
  const url = process.env.ERROR_WEBHOOK_URL;
  try {
    if (url) {
      await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      return;
    }
    const to = process.env.ERROR_EMAIL_TO || process.env.SUPPORT_EMAIL;
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!to || !key || !from || !emailAllowed(summary)) return;
    // Resend called directly: this file is bundled into the edge instrumentation too, and the shared email client pulls in node-only modules.
    const body = JSON.stringify(payload, null, 2);
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: `[angelic-booking] ${summary.slice(0, 120)}`, text: body, html: `<pre style="font:13px/1.4 ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(body)}</pre>` }),
    });
  } catch {
    /* never let reporting throw */
  }
}

// Email throttle: one email per distinct summary every 10 minutes, and at most 20 an hour in all (per instance).
const SAME_EVERY_MS = 10 * 60_000;
const HOURLY_CAP = 20;
const lastSent = new Map<string, number>();
let hourStart = 0;
let hourCount = 0;
export function emailAllowed(summary: string, now = Date.now()): boolean {
  if (now - hourStart > 3_600_000) {
    hourStart = now;
    hourCount = 0;
  }
  if (hourCount >= HOURLY_CAP) return false;
  const key = summary.replace(/[0-9a-f-]{20,}/gi, "#").slice(0, 160);
  const last = lastSent.get(key);
  if (last && now - last < SAME_EVERY_MS) return false;
  lastSent.set(key, now);
  if (lastSent.size > 500) for (const [k, t] of lastSent) if (now - t > SAME_EVERY_MS) lastSent.delete(k);
  hourCount += 1;
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
