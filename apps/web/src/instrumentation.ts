/**
 * Error monitoring hook (Next.js instrumentation).
 *
 * Out of the box, unhandled request errors are POSTed as JSON to ERROR_WEBHOOK_URL
 * when it is set (works with Slack incoming webhooks, Discord, Zapier, or your own
 * endpoint). To use Sentry instead: `pnpm --filter @angelic/web add @sentry/nextjs`,
 * run `npx @sentry/wizard@latest -i nextjs`, and delete this file's webhook code.
 */
export async function register() {
  if (process.env.ERROR_WEBHOOK_URL) console.log("[monitoring] request errors will be reported to ERROR_WEBHOOK_URL");
}

export async function onRequestError(err: unknown, request: { path: string; method: string; headers: Record<string, string | string[] | undefined> }, context: { routerKind: string; routePath: string; routeType: string }) {
  const url = process.env.ERROR_WEBHOOK_URL;
  const e = err as { message?: string; stack?: string; digest?: string };
  const summary = `${request.method} ${request.path} → ${e?.message ?? String(err)}`;
  console.error("[request-error]", summary, e?.digest ?? "");
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:rotating_light: ${summary}`, // Slack/Discord-friendly
        app: "angelic-booking",
        env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
        route: `${context.routerKind} ${context.routeType} ${context.routePath}`,
        digest: e?.digest,
        stack: e?.stack?.split("\n").slice(0, 8).join("\n"),
        at: new Date().toISOString(),
      }),
    });
  } catch {
    /* never let reporting throw */
  }
}
