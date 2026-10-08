/** Thin fetch-based clients for Resend (email) and Twilio (SMS). No SDKs needed. */
import { sendMessage, twilioConfigured } from "@/lib/twilio";

export function emailConfigured(): boolean {
  const k = process.env.RESEND_API_KEY;
  return !!k && !k.endsWith("...") && !!process.env.EMAIL_FROM;
}

/** Twilio credentials are present. Whether a given business can send depends on its verified number (see server/messaging.ts). */
export function smsConfigured(): boolean {
  return twilioConfigured();
}

export async function sendEmail(input: { to: string; subject: string; html: string; text?: string; replyTo?: string }): Promise<{ id: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: input.replyTo,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok) throw new Error(json.message ?? `Resend error ${res.status}`);
  return { id: json.id ?? "" };
}

export type SmsSender = { from?: string; messagingServiceSid?: string };

export async function sendSms(input: { to: string; body: string; sender: SmsSender }): Promise<{ id: string }> {
  const r = await sendMessage({ to: input.to, body: input.body, ...input.sender });
  return { id: r.sid };
}
