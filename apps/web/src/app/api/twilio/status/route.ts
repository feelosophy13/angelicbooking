import { NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio";
import { appUrl } from "@/lib/stripe";
import { recordDeliveryStatus } from "@/server/delivery-status";

/** Twilio message status callback: queued → sent → delivered / undelivered. Rejects unsigned requests. */
export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;
  if (!validateTwilioSignature(appUrl("/api/twilio/status"), params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }
  const sid = params.MessageSid ?? params.SmsSid;
  const status = params.MessageStatus ?? params.SmsStatus;
  if (sid && status) await recordDeliveryStatus({ sid, status, errorCode: params.ErrorCode ?? null }).catch((e) => console.error("[twilio/status] failed", (e as Error).message));
  return new Response(null, { status: 204 });
}
