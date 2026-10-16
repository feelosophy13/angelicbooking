/** Cloudflare Turnstile: a bot check on sign-up. Active only when TURNSTILE_SECRET_KEY is set (production and local both have it). */
export const turnstileEnabled = () => !!process.env.TURNSTILE_SECRET_KEY;

export async function verifyTurnstile(token: string | null | undefined, ip?: string | null, fetcher: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  try {
    const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    if (!res.ok) return false;
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}

/** Where the Turnstile widget may run: the hostnames registered on it in Cloudflare. A business's own booking domain isn't one of them. */
export function turnstileHostnames(env: Record<string, string | undefined> = process.env): string[] {
  return (env.NEXT_PUBLIC_TURNSTILE_HOSTNAMES ?? "app.angelicbooking.com,localhost")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether a page on this host shows (and its form must pass) the bot check. */
export function botCheckOn(host: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!env.TURNSTILE_SECRET_KEY || !env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return false;
  const name = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  return turnstileHostnames(env).includes(name);
}

export const BOT_CHECK_FAILED = "Please complete the check that you're not a robot, then try again.";

/**
 * The bot check for a public form (booking, waitlist, login code, shared forms, store). Reads the request's host and address itself.
 * Returns an error message to show, or null when the visitor passed (or the check is off for this host).
 */
export async function publicBotCheck(token: FormDataEntryValue | string | null | undefined, fetcher: typeof fetch = fetch): Promise<string | null> {
  const { headers } = await import("next/headers");
  const { clientIpFrom } = await import("./rate-limit");
  const h = await headers();
  if (!botCheckOn(h.get("x-forwarded-host") ?? h.get("host"))) return null;
  return (await verifyTurnstile(typeof token === "string" ? token : null, clientIpFrom(h), fetcher)) ? null : BOT_CHECK_FAILED;
}
