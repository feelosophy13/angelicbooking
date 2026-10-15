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
