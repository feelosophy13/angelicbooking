import { NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio";
import { appUrl } from "@/lib/stripe";
import { recordInboundSms } from "@/server/inbound";

/**
 * Inbound SMS webhook for every business number. Twilio handles STOP/HELP
 * itself for US toll-free numbers; replies (and any pictures) are stored against
 * the client (STOP/START also update their opt-in). The only automatic answer is
 * HELP on a number Twilio does not manage. Rejects unsigned requests.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;
  if (!validateTwilioSignature(appUrl("/api/twilio/inbound"), params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }
  let reply: string | null = null;
  if (params.From && params.To) {
    const media = Array.from({ length: Math.min(Number(params.NumMedia) || 0, 10) }, (_, i) => ({ url: params[`MediaUrl${i}`] ?? "", type: params[`MediaContentType${i}`] ?? "" })).filter((m) => m.url.startsWith("https://"));
    const r = await recordInboundSms({ from: params.From, to: params.To, body: params.Body ?? "", sid: params.MessageSid ?? params.SmsSid ?? null, media }).catch((e) => {
      console.error("[twilio/inbound] store failed", (e as Error).message);
      return null;
    });
    reply = r?.reply ?? null;
  }
  const xml = (reply ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${reply ? `<Message>${xml}</Message>` : ""}</Response>`, { headers: { "Content-Type": "text/xml" } });
}
