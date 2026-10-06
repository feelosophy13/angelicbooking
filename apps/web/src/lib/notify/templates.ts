import { formatTime } from "@/lib/utils";

export interface ApptContext {
  businessName: string;
  businessPhone: string | null;
  address: string | null;
  timeZone: string;
  clientFirstName: string;
  services: string; // "Full Color, Women's Haircut"
  staffName: string;
  startAt: Date;
  manageUrl: string;
  policy: string | null;
  cancelWindowHours: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function when(ctx: ApptContext) {
  const d = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: ctx.timeZone }).format(ctx.startAt);
  return `${d} at ${formatTime(ctx.startAt, ctx.timeZone)}`;
}

function shell(ctx: ApptContext, title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#faf9f7;padding:24px;color:#1c1917">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:24px">
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
${bodyHtml}
<p style="font-size:12px;color:#78716c;margin-top:24px">${esc(ctx.businessName)}${ctx.address ? ` · ${esc(ctx.address)}` : ""}${ctx.businessPhone ? ` · ${esc(ctx.businessPhone)}` : ""}</p>
</div></body></html>`;
}

function details(ctx: ApptContext) {
  return `<table style="font-size:15px;border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#78716c">When</td><td>${esc(when(ctx))}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#78716c">Service</td><td>${esc(ctx.services)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#78716c">With</td><td>${esc(ctx.staffName)}</td></tr></table>`;
}

function manage(ctx: ApptContext) {
  return `<p style="margin-top:16px"><a href="${ctx.manageUrl}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Manage appointment</a></p>
<p style="font-size:13px;color:#78716c">You can cancel or reschedule online up to ${ctx.cancelWindowHours} hours before your appointment.${ctx.policy ? ` ${esc(ctx.policy)}` : ""}</p>`;
}

export const templates = {
  confirmation: (ctx: ApptContext) => ({
    subject: `Confirmed: ${ctx.services} at ${ctx.businessName}`,
    html: shell(ctx, `You're booked, ${ctx.clientFirstName}!`, details(ctx) + manage(ctx)),
    sms: `${ctx.businessName}: you're booked for ${ctx.services} with ${ctx.staffName} on ${when(ctx)}. Manage: ${ctx.manageUrl}`,
  }),
  reminder: (ctx: ApptContext) => ({
    subject: `Reminder: ${ctx.services} ${when(ctx)}`,
    html: shell(ctx, `See you soon, ${ctx.clientFirstName}`, details(ctx) + manage(ctx)),
    sms: `${ctx.businessName} reminder: ${ctx.services} with ${ctx.staffName} ${when(ctx)}. Manage: ${ctx.manageUrl}`,
  }),
  rescheduled: (ctx: ApptContext) => ({
    subject: `Updated: ${ctx.services} at ${ctx.businessName}`,
    html: shell(ctx, `Your appointment was moved`, details(ctx) + manage(ctx)),
    sms: `${ctx.businessName}: your ${ctx.services} appointment is now ${when(ctx)} with ${ctx.staffName}. Manage: ${ctx.manageUrl}`,
  }),
  cancellation: (ctx: ApptContext) => ({
    subject: `Cancelled: ${ctx.services} at ${ctx.businessName}`,
    html: shell(ctx, `Your appointment was cancelled`, `<p>${esc(ctx.services)} on ${esc(when(ctx))} has been cancelled.</p><p>Book again any time${ctx.businessPhone ? ` or call ${esc(ctx.businessPhone)}` : ""}.</p>`),
    sms: `${ctx.businessName}: your ${ctx.services} appointment on ${when(ctx)} was cancelled.`,
  }),
};
export type TemplateName = keyof typeof templates;

export function inviteEmail(input: { businessName: string; role: string; link: string }) {
  return {
    subject: `You're invited to join ${input.businessName}`,
    html: `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:24px;color:#1c1917">
<p>You've been invited to join <strong>${esc(input.businessName)}</strong> as ${esc(input.role.replace("_", " "))}.</p>
<p><a href="${input.link}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Accept invitation</a></p>
<p style="font-size:12px;color:#78716c">The link expires in 7 days.</p></body></html>`,
  };
}
