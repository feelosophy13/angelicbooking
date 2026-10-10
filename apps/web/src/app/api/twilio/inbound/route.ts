import { NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio";
import { appUrl } from "@/lib/stripe";
import { recordInboundSms } from "@/server/inbound";

/**
 * Inbound SMS webhook for every business number. Twilio handles STOP/HELP
 * itself for US toll-free numbers; replies are stored against the client (STOP/
 * START also update their opt-in) and answered with empty TwiML so nothing
 * auto-responds. Rejects unsigned requests.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;
  if (!validateTwilioSignature(appUrl("/api/twilio/inbound"), params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }
  if (params.From && params.To) {
    await recordInboundSms({ from: params.From, to: params.To, body: params.Body ?? "", sid: params.MessageSid ?? params.SmsSid ?? null }).catch((e) => console.error("[twilio/inbound] store failed", (e as Error).message));
  }
  return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", { headers: { "Content-Type": "text/xml" } });
}
