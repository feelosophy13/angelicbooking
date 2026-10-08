/**
 * Thin fetch-based Twilio client (no SDK), covering what the app needs:
 * toll-free number search/purchase/release, toll-free verification, outbound
 * SMS and webhook signature validation. Uses the PLATFORM's Twilio account;
 * each business gets its own number inside it (see server/messaging.ts).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.twilio.com/2010-04-01";
const MESSAGING = "https://messaging.twilio.com/v1";

export class TwilioError extends Error {
  constructor(message: string, public code?: number, public status?: number) {
    super(message);
  }
}

export function twilioConfigured(): boolean {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  return !!sid && !!tok && sid.startsWith("AC") && !sid.endsWith("...");
}

/** Platform-wide fallback sender, used when a business has no verified number of its own. */
export function platformSmsSender(): { from?: string; messagingServiceSid?: string } | null {
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) return { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID };
  if (process.env.TWILIO_FROM) return { from: process.env.TWILIO_FROM };
  return null;
}

type Params = Record<string, string | string[] | undefined | null>;

export function encodeParams(params: Params): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.append(k, v);
  }
  return p;
}

async function request<T>(method: "GET" | "POST" | "DELETE", url: string, params?: Params): Promise<T> {
  if (!twilioConfigured()) throw new TwilioError("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)");
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const headers: Record<string, string> = { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}` };
  let target = url;
  const init: RequestInit = { method, headers };
  if (params && method === "GET") target += (url.includes("?") ? "&" : "?") + encodeParams(params).toString();
  else if (params) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = encodeParams(params);
  }
  const res = await fetch(target, init);
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
  if (!res.ok) throw new TwilioError(json.message ?? `Twilio error ${res.status}`, json.code, res.status);
  return json as T;
}

const account = () => `${API}/Accounts/${process.env.TWILIO_ACCOUNT_SID}`;

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export type AvailableNumber = { phoneNumber: string; friendlyName: string };

export async function searchTollFree(opts: { contains?: string; limit?: number } = {}): Promise<AvailableNumber[]> {
  const r = await request<{ available_phone_numbers: { phone_number: string; friendly_name: string }[] }>("GET", `${account()}/AvailablePhoneNumbers/US/TollFree.json`, {
    SmsEnabled: "true",
    PageSize: String(opts.limit ?? 10),
    Contains: opts.contains?.replace(/[^\d*A-Za-z]/g, "") || undefined,
  });
  return (r.available_phone_numbers ?? []).map((n) => ({ phoneNumber: n.phone_number, friendlyName: n.friendly_name }));
}

export async function purchaseNumber(phoneNumber: string, opts: { friendlyName: string; smsUrl?: string }): Promise<{ sid: string; phoneNumber: string }> {
  const r = await request<{ sid: string; phone_number: string }>("POST", `${account()}/IncomingPhoneNumbers.json`, {
    PhoneNumber: phoneNumber,
    FriendlyName: opts.friendlyName.slice(0, 64),
    SmsUrl: opts.smsUrl,
    SmsMethod: opts.smsUrl ? "POST" : undefined,
  });
  return { sid: r.sid, phoneNumber: r.phone_number };
}

export async function releaseNumber(sid: string): Promise<void> {
  try {
    await request<void>("DELETE", `${account()}/IncomingPhoneNumbers/${sid}.json`);
  } catch (e) {
    if (e instanceof TwilioError && e.status === 404) return; // already gone
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Toll-free verification
// ---------------------------------------------------------------------------

export type TollfreeStatus = "PENDING_REVIEW" | "IN_REVIEW" | "TWILIO_APPROVED" | "TWILIO_REJECTED";

export interface TollfreeVerification {
  sid: string;
  status: TollfreeStatus;
  rejectionReason: string | null;
  rejectionReasons: unknown[];
  editAllowed: boolean;
}

export interface TollfreeVerificationInput {
  tollfreePhoneNumberSid: string;
  businessName: string;
  businessWebsite: string;
  notificationEmail: string;
  businessType: "PRIVATE_PROFIT" | "PUBLIC_PROFIT" | "SOLE_PROPRIETOR" | "NON_PROFIT" | "GOVERNMENT";
  businessRegistrationNumber?: string | null; // EIN; not needed for sole proprietors
  businessStreetAddress?: string | null;
  businessCity?: string | null;
  businessStateProvinceRegion?: string | null;
  businessPostalCode?: string | null;
  businessCountry?: string;
  businessContactFirstName?: string | null;
  businessContactLastName?: string | null;
  businessContactEmail?: string | null;
  businessContactPhone?: string | null; // E.164
  useCaseCategories: string[];
  useCaseSummary: string;
  productionMessageSample: string;
  optInImageUrls: string[];
  optInType: "VERBAL" | "WEB_FORM" | "PAPER_FORM" | "VIA_TEXT" | "MOBILE_QR_CODE";
  messageVolume: string; // "10" | "100" | "1,000" | "10,000" | ...
  additionalInformation?: string | null;
  privacyPolicyUrl?: string;
  termsAndConditionsUrl?: string;
  optInConfirmationMessage?: string;
  helpMessageSample?: string;
  externalReferenceId?: string;
}

export function tollfreeParams(input: TollfreeVerificationInput): Params {
  const sole = input.businessType === "SOLE_PROPRIETOR";
  return {
    TollfreePhoneNumberSid: input.tollfreePhoneNumberSid,
    BusinessName: input.businessName,
    BusinessWebsite: input.businessWebsite,
    NotificationEmail: input.notificationEmail,
    BusinessType: input.businessType,
    BusinessRegistrationNumber: sole ? undefined : input.businessRegistrationNumber,
    BusinessRegistrationAuthority: sole ? undefined : "EIN",
    BusinessRegistrationCountry: sole ? undefined : "US",
    BusinessStreetAddress: input.businessStreetAddress,
    BusinessCity: input.businessCity,
    BusinessStateProvinceRegion: input.businessStateProvinceRegion,
    BusinessPostalCode: input.businessPostalCode,
    BusinessCountry: input.businessCountry ?? "US",
    BusinessContactFirstName: input.businessContactFirstName,
    BusinessContactLastName: input.businessContactLastName,
    BusinessContactEmail: input.businessContactEmail,
    BusinessContactPhone: input.businessContactPhone,
    UseCaseCategories: input.useCaseCategories,
    UseCaseSummary: input.useCaseSummary,
    ProductionMessageSample: input.productionMessageSample,
    OptInImageUrls: input.optInImageUrls,
    OptInType: input.optInType,
    MessageVolume: input.messageVolume,
    AdditionalInformation: input.additionalInformation,
    PrivacyPolicyUrl: input.privacyPolicyUrl,
    TermsAndConditionsUrl: input.termsAndConditionsUrl,
    OptInConfirmationMessage: input.optInConfirmationMessage,
    HelpMessageSample: input.helpMessageSample,
    ExternalReferenceId: input.externalReferenceId,
  };
}

function mapVerification(r: { sid: string; status: TollfreeStatus; rejection_reason?: string | null; rejection_reasons?: unknown[] | null; edit_allowed?: boolean | null }): TollfreeVerification {
  return { sid: r.sid, status: r.status, rejectionReason: r.rejection_reason ?? null, rejectionReasons: r.rejection_reasons ?? [], editAllowed: !!r.edit_allowed };
}

export async function createTollfreeVerification(input: TollfreeVerificationInput): Promise<TollfreeVerification> {
  return mapVerification(await request("POST", `${MESSAGING}/Tollfree/Verifications`, tollfreeParams(input)));
}

/** Resubmit a rejected verification (only when Twilio reports edit_allowed). */
export async function updateTollfreeVerification(sid: string, input: TollfreeVerificationInput): Promise<TollfreeVerification> {
  const params = tollfreeParams(input);
  delete params.TollfreePhoneNumberSid;
  return mapVerification(await request("POST", `${MESSAGING}/Tollfree/Verifications/${sid}`, params));
}

export async function fetchTollfreeVerification(sid: string): Promise<TollfreeVerification> {
  return mapVerification(await request("GET", `${MESSAGING}/Tollfree/Verifications/${sid}`));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function sendMessage(input: { to: string; body: string; from?: string; messagingServiceSid?: string }): Promise<{ sid: string }> {
  const r = await request<{ sid: string }>("POST", `${account()}/Messages.json`, {
    To: input.to,
    Body: input.body,
    From: input.messagingServiceSid ? undefined : input.from,
    MessagingServiceSid: input.messagingServiceSid,
  });
  return { sid: r.sid };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * Twilio signs webhooks with HMAC-SHA1 over the full URL followed by the POST
 * params sorted by key (key immediately followed by value, no separators).
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function validateTwilioSignature(url: string, params: Record<string, string>, signature: string | null, authToken = process.env.TWILIO_AUTH_TOKEN ?? ""): boolean {
  if (!signature || !authToken) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
