/** Thin fetch-based clients for Resend (email) and Twilio (SMS). No SDKs needed. */

export function emailConfigured(): boolean {
  const k = process.env.RESEND_API_KEY;
  return !!k && !k.endsWith("...") && !!process.env.EMAIL_FROM;
}

export function smsConfigured(): boolean {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM ?? process.env.TWILIO_MESSAGING_SERVICE_SID;
  return !!sid && !!tok && !!from && !sid.endsWith("...");
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

export async function sendSms(input: { to: string; body: string }): Promise<{ id: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const params = new URLSearchParams({ To: input.to, Body: input.body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) params.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else params.set("From", process.env.TWILIO_FROM!);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(json.message ?? `Twilio error ${res.status}`);
  return { id: json.sid ?? "" };
}
