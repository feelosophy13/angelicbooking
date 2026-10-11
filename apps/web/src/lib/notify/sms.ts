/**
 * Text-message wording: per-business overrides with placeholders, and the
 * "Reply STOP to opt out" notice that US carriers expect on the first message
 * to a number (and on every marketing message).
 */
import { eq } from "drizzle-orm";
import { schema, type TenantDb } from "@angelic/db";
import type { ApptContext } from "./templates";
import { formatTime } from "@/lib/utils";

export const SMS_TEMPLATE_KEYS = ["confirmation", "reminder", "rescheduled", "cancellation", "forms_nudge", "review_request"] as const;
export type SmsTemplateKey = (typeof SMS_TEMPLATE_KEYS)[number];

export const SMS_PLACEHOLDERS = ["{first_name}", "{business}", "{service}", "{staff}", "{when}", "{manage_url}", "{deposit}", "{forms_url}", "{review_url}"] as const;

export const SMS_DEFAULTS: Record<SmsTemplateKey, string> = {
  confirmation: "{business}: you're booked for {service} with {staff} on {when}. Manage: {manage_url}",
  reminder: "{business} reminder: {service} with {staff} {when}. Manage: {manage_url}",
  rescheduled: "{business}: your {service} appointment is now {when} with {staff}. Manage: {manage_url}",
  cancellation: "{business}: your {service} appointment on {when} was cancelled.",
  forms_nudge: "{business}: see you today for {service}. Please complete your form first: {forms_url}",
  review_request: "{business}: thanks for coming in! How was your visit? Rate us in 10 seconds: {review_url}",
};

export const STOP_NOTICE = "Reply STOP to opt out.";

export function smsVars(ctx: ApptContext, extra: { review_url?: string } = {}): Record<string, string> {
  const d = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: ctx.timeZone }).format(ctx.startAt);
  return {
    first_name: ctx.clientFirstName,
    business: ctx.businessName,
    service: ctx.services,
    staff: ctx.staffName,
    when: `${d} at ${formatTime(ctx.startAt, ctx.timeZone)}`,
    manage_url: ctx.manageUrl,
    deposit: ctx.depositPaid ?? "",
    forms_url: ctx.formsUrl ?? "",
    review_url: extra.review_url ?? "",
  };
}

export function renderSms(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? m : vars[k]))
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** The wording for a template: the business's own text if set, else the default; extras (deposit, forms) appended once. */
export function smsBody(business: { smsTemplates: Record<string, string> }, key: SmsTemplateKey, ctx: ApptContext, extra: { review_url?: string } = {}): string {
  const custom = business.smsTemplates?.[key]?.trim();
  const vars = smsVars(ctx, extra);
  let body = renderSms(custom || SMS_DEFAULTS[key], vars);
  if (!custom) {
    if (key === "confirmation" && ctx.depositPaid) body = body.replace(" Manage:", ` Deposit paid: ${ctx.depositPaid}. Manage:`);
    if ((key === "confirmation" || key === "reminder") && ctx.formsUrl) body = body.replace(" Manage:", ` Please complete your forms: ${ctx.formsUrl} Manage:`);
  }
  return body;
}

/**
 * Append the STOP notice when this client has never received it (and record
 * that), or always for marketing texts. Must run inside the tenant tx.
 */
export async function smsWithStopNotice(tx: TenantDb, client: { id: string; smsStopNoticeAt: Date | null }, body: string, marketing = false): Promise<string> {
  if (marketing) return `${body} ${STOP_NOTICE}`;
  if (client.smsStopNoticeAt) return body;
  await tx.update(schema.clients).set({ smsStopNoticeAt: new Date() }).where(eq(schema.clients.id, client.id));
  return `${body} ${STOP_NOTICE}`;
}
