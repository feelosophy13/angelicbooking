import { NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio";
import { appUrl } from "@/lib/stripe";

/**
 * Inbound SMS webhook for every business number. Twilio handles STOP/HELP
 * itself for US toll-free numbers; we acknowledge anything else with empty
 * TwiML so replies never bounce or auto-respond. Rejects unsigned requests.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;
  if (!validateTwilioSignature(appUrl("/api/twilio/inbound"), params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }
  return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", { headers: { "Content-Type": "text/xml" } });
}
