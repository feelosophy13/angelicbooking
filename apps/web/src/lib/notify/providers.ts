/** Thin fetch-based clients for Resend (email) and Twilio (SMS). No SDKs needed. */
import { sendMessage, twilioConfigured } from "@/lib/twilio";
import { appUrl } from "@/lib/stripe";

export function emailConfigured(): boolean {
  const k = process.env.RESEND_API_KEY;
  return !!k && !k.endsWith("...") && !!process.env.EMAIL_FROM;
}

/** Twilio credentials are present. Whether a given business can send depends on its verified number (see server/messaging.ts). */
export function smsConfigured(): boolean {
  return twilioConfigured();
}

/** "Angelic Beauty <hello@mail1.angelicbooking.com>": the platform address with the business as the display name. */
export function fromAddress(fromName?: string | null): string {
  const raw = process.env.EMAIL_FROM ?? "";
  const addr = /<([^>]+)>/.exec(raw)?.[1] ?? raw;
  return fromName ? `${fromName.replace(/["<>]/g, "")} <${addr}>` : raw;
}

/** Resend said "too many requests". `retryAfterMs` is how long it asked us to wait. */
export class EmailRateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super("Resend rate limit");
  }
}

/** Calls per second Resend allows this account (2 on the default plan; raise RESEND_MAX_PER_SECOND if Resend raises the limit). */
const EMAIL_PER_SECOND = Math.max(1, Number(process.env.RESEND_MAX_PER_SECOND) || 2);
let nextEmailSlot = 0;

/** Wait for this process's next free slot under the Resend rate limit. Calls in flight together get consecutive slots. */
export async function emailTurn(now = Date.now()) {
  const slot = Math.max(now, nextEmailSlot);
  nextEmailSlot = slot + 1000 / EMAIL_PER_SECOND;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

export async function sendEmail(input: { to: string; subject: string; html: string; text?: string; replyTo?: string; fromName?: string | null; headers?: Record<string, string> }): Promise<{ id: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromAddress(input.fromName),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: input.replyTo,
      ...(input.headers ? { headers: input.headers } : {}),
    }),
  });
  if (res.status === 429) {
    const after = Number(res.headers.get("retry-after"));
    throw new EmailRateLimitError(Number.isFinite(after) && after > 0 ? after * 1000 : 1000);
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok) throw new Error(json.message ?? `Resend error ${res.status}`);
  return { id: json.id ?? "" };
}

export type SmsSender = { from?: string; messagingServiceSid?: string };

export async function sendSms(input: { to: string; body: string; sender: SmsSender }): Promise<{ id: string }> {
  // The callback reports carrier delivery (delivered / undelivered) to /api/twilio/status.
  const r = await sendMessage({ to: input.to, body: input.body, ...input.sender, statusCallback: appUrl("/api/twilio/status") });
  return { id: r.sid };
}
