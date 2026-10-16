/**
 * Send a failure to ERROR_WEBHOOK_URL (Slack/Discord-compatible JSON) when it is set, and always to the log. Used by Next's request-error
 * hook, by the REST API (which answers its own 500s, so Next never sees them) and by the background jobs (which carry on past a failing
 * step). Never throws.
 */
export async function reportError(summary: string, err?: unknown, extra: Record<string, unknown> = {}) {
  const e = err as { message?: string; stack?: string; digest?: string } | undefined;
  console.error("[error]", summary, e?.stack ?? e?.message ?? "");
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:rotating_light: ${summary}`,
        app: "angelic-booking",
        env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
        digest: e?.digest,
        stack: e?.stack?.split("\n").slice(0, 8).join("\n"),
        at: new Date().toISOString(),
        ...extra,
      }),
    });
  } catch {
    /* never let reporting throw */
  }
}
