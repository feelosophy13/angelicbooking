import { appUrl } from "@/lib/stripe";
import { formatTime } from "@/lib/utils";

export interface ApptContext {
  businessName: string;
  logoUrl?: string | null;
  brandColor?: string | null;
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
  /** "$25.00" or "50% of the booked services" when a late-cancellation fee applies; null when none. */
  lateCancelFee?: string | null;
  /** Formatted deposit already paid online, e.g. "$25.00"; null when none. */
  depositPaid?: string | null;
  /** True when a card was saved at booking (nothing charged). */
  cardOnFile?: boolean;
  /** Link to outstanding intake/consent forms for this visit; null when none are due. */
  formsUrl?: string | null;
  /** "Before your visit" instructions for the booked services (service's own, else its category's), deduplicated. */
  prepNotes?: string[];
  /** How many pictures the client attached when booking online (inspiration, their current lashes); 0 or missing when none. */
  clientPhotos?: number;
  /** The booker of a group: everyone booked with them ("Mia: Kids cut with Ana at 2:30 PM"). */
  guests?: string[];
}

/** "2 photos from the client" for the team's messages; null when the client attached none. */
export const clientPhotosLine = (n: number | null | undefined) => (n && n > 0 ? `${n} photo${n === 1 ? "" : "s"} from the client` : null);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function when(ctx: ApptContext) {
  const d = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: ctx.timeZone }).format(ctx.startAt);
  return `${d} at ${formatTime(ctx.startAt, ctx.timeZone)}`;
}

export type BrandCtx = Pick<ApptContext, "businessName" | "logoUrl" | "brandColor" | "businessPhone" | "address">;

function shell(ctx: BrandCtx, title: string, bodyHtml: string) {
  const brand = ctx.brandColor && /^#[0-9a-fA-F]{6}$/.test(ctx.brandColor) ? ctx.brandColor : "#6d28d9";
  const header = ctx.logoUrl
    ? `<img src="${ctx.logoUrl}" alt="${esc(ctx.businessName)}" height="40" style="height:40px;max-width:160px;object-fit:contain;display:block">`
    : `<span style="font-size:16px;font-weight:600;color:#fff">${esc(ctx.businessName)}</span>`;
  return `<!doctype html><html><body style="margin:0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#faf9f7;padding:24px;color:#1c1917">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;overflow:hidden">
<div style="background:${brand};padding:14px 24px">${header}</div>
<div style="padding:24px">
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
${bodyHtml.replace(/#6d28d9/g, brand)}
<p style="font-size:12px;color:#78716c;margin-top:24px">${esc(ctx.businessName)}${ctx.address ? ` · ${esc(ctx.address)}` : ""}${ctx.businessPhone ? ` · ${esc(ctx.businessPhone)}` : ""}</p>
</div></div>
<p style="max-width:520px;margin:12px auto 0;font-size:11px;color:#a8a29e;text-align:center"><img src="${appUrl("/brand/mark-192.png")}" alt="" width="16" height="16" style="vertical-align:-3px;margin-right:4px;border-radius:4px">Sent by Angelic Booking on behalf of ${esc(ctx.businessName)}.</p>
</body></html>`;
}

function details(ctx: ApptContext) {
  return `<table style="font-size:15px;border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#78716c">When</td><td>${esc(when(ctx))}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#78716c">Service</td><td>${esc(ctx.services)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#78716c">With</td><td>${esc(ctx.staffName)}</td></tr>${
    ctx.guests?.length ? `<tr><td style="padding:4px 12px 4px 0;color:#78716c;vertical-align:top">Also booked</td><td>${ctx.guests.map(esc).join("<br>")}</td></tr>` : ""
  }${
    ctx.depositPaid ? `<tr><td style="padding:4px 12px 4px 0;color:#78716c">Deposit paid</td><td>${esc(ctx.depositPaid)}</td></tr>` : ctx.cardOnFile ? `<tr><td style="padding:4px 12px 4px 0;color:#78716c">Card</td><td>Saved on file (nothing charged)</td></tr>` : ""
  }</table>`;
}

function formsNote(ctx: ApptContext) {
  return ctx.formsUrl ? `<p style="margin-top:16px;padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:14px">Please complete your forms before your visit: <a href="${ctx.formsUrl}" style="color:#6d28d9">Complete forms</a></p>` : "";
}

function prepNote(ctx: ApptContext) {
  if (!ctx.prepNotes?.length) return "";
  const items = ctx.prepNotes.map((n) => `<li style="margin:4px 0">${esc(n)}</li>`).join("");
  return `<div style="margin-top:16px;padding:12px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;font-size:14px"><p style="margin:0 0 4px;font-weight:600">Before your visit</p><ul style="margin:0;padding-left:18px">${items}</ul></div>`;
}

function manage(ctx: ApptContext) {
  return `${prepNote(ctx)}${formsNote(ctx)}<p style="margin-top:16px"><a href="${ctx.manageUrl}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Manage appointment</a></p>
<p style="font-size:13px;color:#78716c">You can cancel or reschedule online up to ${ctx.cancelWindowHours} hours before your appointment.${ctx.lateCancelFee ? ` Cancellations inside that window carry a fee of ${esc(ctx.lateCancelFee)}.` : ""}${ctx.policy ? ` ${esc(ctx.policy)}` : ""}</p>`;
}

/** A message's parts: `title` and `content` are what a custom email design (lib/email-design) wraps; `html` is the default look. */
function parts(ctx: BrandCtx, subject: string, title: string, content: string) {
  return { subject, title, content, html: shell(ctx, title, content) };
}

export const templates = {
  confirmation: (ctx: ApptContext) => ({
    ...parts(ctx, `Confirmed: ${ctx.services} at ${ctx.businessName}`, `You're booked, ${ctx.clientFirstName}!`, details(ctx) + manage(ctx)),
    sms: `${ctx.businessName}: you're booked for ${ctx.services} with ${ctx.staffName} on ${when(ctx)}.${ctx.depositPaid ? ` Deposit paid: ${ctx.depositPaid}.` : ""}${ctx.formsUrl ? ` Please complete your forms: ${ctx.formsUrl}` : ""} Manage: ${ctx.manageUrl}`,
  }),
  reminder: (ctx: ApptContext) => ({
    ...parts(ctx, `Reminder: ${ctx.services} ${when(ctx)}`, `See you soon, ${ctx.clientFirstName}`, details(ctx) + manage(ctx)),
    sms: `${ctx.businessName} reminder: ${ctx.services} with ${ctx.staffName} ${when(ctx)}.${ctx.formsUrl ? ` Forms: ${ctx.formsUrl}` : ""} Manage: ${ctx.manageUrl}`,
  }),
  rescheduled: (ctx: ApptContext) => ({
    ...parts(ctx, `Updated: ${ctx.services} at ${ctx.businessName}`, `Your appointment was moved`, details(ctx) + manage(ctx)),
    sms: `${ctx.businessName}: your ${ctx.services} appointment is now ${when(ctx)} with ${ctx.staffName}. Manage: ${ctx.manageUrl}`,
  }),
  formsNudge: (ctx: ApptContext) => ({
    ...parts(ctx, `Before your visit today: a form to complete`, `See you ${esc(when(ctx)).replace(/^.*? at /, "at ")}, ${ctx.clientFirstName}`, `<p>Your ${esc(ctx.services)} with ${esc(ctx.staffName)} is coming up. One quick thing first:</p>${formsNote(ctx)}<p style="font-size:13px;color:#78716c">It takes a minute on your phone and saves time at the front desk.</p>`),
    sms: `${ctx.businessName}: see you today for ${ctx.services}. Please complete your form first: ${ctx.formsUrl}`,
  }),
  cancellation: (ctx: ApptContext) => ({
    ...parts(ctx, `Cancelled: ${ctx.services} at ${ctx.businessName}`, `Your appointment was cancelled`, `<p>${esc(ctx.services)} on ${esc(when(ctx))} has been cancelled.</p><p>Book again any time${ctx.businessPhone ? ` or call ${esc(ctx.businessPhone)}` : ""}.</p>`),
    sms: `${ctx.businessName}: your ${ctx.services} appointment on ${when(ctx)} was cancelled.`,
  }),
};
export type TemplateName = keyof typeof templates;

/** "How did we do?" sent a little while after a completed visit. */
export function reviewRequestTemplate(ctx: ApptContext, reviewUrl: string) {
  const stars = [1, 2, 3, 4, 5].map((n) => `<a href="${reviewUrl}?rating=${n}" style="display:inline-block;width:40px;height:40px;line-height:40px;text-align:center;font-size:24px;text-decoration:none;color:#f59e0b" title="${n} star${n === 1 ? "" : "s"}">★</a>`).join("");
  return {
    ...parts(ctx, `How was your visit to ${ctx.businessName}?`, `Thanks for coming in, ${ctx.clientFirstName}!`, `<p>How was your ${esc(ctx.services)} with ${esc(ctx.staffName)}? Tap a star:</p><p style="margin:12px 0">${stars}</p><p style="font-size:13px;color:#78716c">It takes ten seconds and helps ${esc(ctx.businessName)} a lot.</p><p style="font-size:12px;color:#a8a29e;margin-top:16px"><a href="${reviewUrl}?optout=1" style="color:#a8a29e">Don't ask me again</a></p>`),
    sms: `${ctx.businessName}: thanks for coming in! How was your visit? Rate us in 10 seconds: ${reviewUrl}`,
  };
}

export function inviteEmail(input: { businessName: string; role: string; link: string }) {
  return {
    subject: `You're invited to join ${input.businessName}`,
    html: `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:24px;color:#1c1917">
<p>You've been invited to join <strong>${esc(input.businessName)}</strong> as ${esc(input.role.replace("_", " "))}.</p>
<p><a href="${input.link}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Accept invitation</a></p>
<p style="font-size:12px;color:#78716c">The link expires in 7 days.</p></body></html>`,
  };
}

/** Heads-up to the business when a client books or cancels online. */
export function staffAlertEmail(ctx: ApptContext, kind: "booked" | "cancelled" | "rescheduled", clientName: string, appointmentUrl: string) {
  const verb = kind === "booked" ? "booked online" : kind === "cancelled" ? "cancelled online" : "rescheduled online";
  const photos = clientPhotosLine(ctx.clientPhotos);
  const subject = `${clientName} ${verb}: ${ctx.services} · ${when(ctx)}${photos ? " · photos attached" : ""}`;
  const html = shell(ctx, `${clientName} ${verb}`, `${details(ctx)}${photos ? `
<p style="margin-top:12px;padding:10px 12px;background:#f5f5f4;border-radius:8px;font-size:14px">${esc(photos.charAt(0).toUpperCase() + photos.slice(1))} are on the appointment.</p>` : ""}
<p style="margin-top:16px"><a href="${appointmentUrl}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Open appointment</a></p>
<p style="font-size:12px;color:#78716c">You receive these because online booking alerts go to your business email. Change it under Settings → Business profile.</p>`);
  return { subject, html };
}

/** Branded wrapper for one-off emails (campaigns, automations, store). */
export function brandedEmail(ctx: BrandCtx, title: string, bodyHtml: string) {
  return shell(ctx, title, bodyHtml);
}

/** Plain text (with blank lines) → paragraphs, escaped. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Marketing email: body paragraphs + optional button + unsubscribe line. */
export function marketingEmail(ctx: BrandCtx, input: { subject: string; text: string; ctaLabel?: string | null; ctaUrl?: string | null; unsubscribeUrl: string }) {
  const cta = input.ctaUrl ? `<p style="margin-top:16px"><a href="${input.ctaUrl}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">${esc(input.ctaLabel ?? "Book now")}</a></p>` : "";
  const html = shell(ctx, input.subject, `${textToHtml(input.text)}${cta}<p style="font-size:11px;color:#a8a29e;margin-top:24px"><a href="${input.unsubscribeUrl}" style="color:#a8a29e">Unsubscribe from emails like this</a></p>`);
  return { subject: input.subject, html };
}

/** Transactional email from a workflow step (aftercare, a payment that failed, a no-show follow-up): same shape, no unsubscribe line. */
export function transactionalEmail(ctx: BrandCtx, input: { subject: string; text: string; ctaLabel?: string | null; ctaUrl?: string | null }) {
  const cta = input.ctaUrl ? `<p style="margin-top:16px"><a href="${input.ctaUrl}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">${esc(input.ctaLabel ?? "Book now")}</a></p>` : "";
  return { subject: input.subject, html: shell(ctx, input.subject, `${textToHtml(input.text)}${cta}`) };
}

/** Gift card bought online, sent to the recipient. */
export function giftCardEmail(ctx: BrandCtx, input: { code: string; amount: string; from: string | null; message: string | null; bookingUrl: string }) {
  const body = `<p style="font-size:15px">${input.from ? `${esc(input.from)} sent you a gift card` : "You've received a gift card"} for <b>${esc(ctx.businessName)}</b>.</p>
<div style="margin:16px 0;padding:16px;border:2px dashed #6d28d9;border-radius:12px;text-align:center"><p style="margin:0;font-size:13px;color:#78716c">Gift card</p><p style="margin:4px 0;font-size:28px;font-weight:700">${esc(input.amount)}</p><p style="margin:0;font-family:monospace;font-size:18px;letter-spacing:2px">${esc(input.code)}</p></div>
${input.message ? `<p style="font-style:italic;color:#44403c">“${esc(input.message)}”</p>` : ""}
<p style="font-size:14px">Give the code at checkout, or mention it when you book. It never expires unless the salon says otherwise.</p>
<p style="margin-top:16px"><a href="${input.bookingUrl}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Book an appointment</a></p>`;
  return parts(ctx, `A ${input.amount} gift card for ${ctx.businessName}`, "You've got a gift card!", body);
}

/** Order confirmation for an online store purchase. */
export function orderEmail(ctx: BrandCtx, input: { number: number; lines: { name: string; quantity: number; amount: string }[]; total: string; method: "pickup" | "ship"; address: string | null }) {
  const rows = input.lines.map((l) => `<tr><td style="padding:3px 0">${esc(l.quantity > 1 ? `${l.name} × ${l.quantity}` : l.name)}</td><td style="padding:3px 0;text-align:right">${esc(l.amount)}</td></tr>`).join("");
  const body = `<p style="color:#78716c;margin:0 0 12px">Order #${input.number}</p><table style="width:100%;font-size:15px;border-collapse:collapse">${rows}<tr><td style="padding-top:8px;border-top:1px solid #e7e5e4;font-weight:600">Total</td><td style="padding-top:8px;border-top:1px solid #e7e5e4;text-align:right;font-weight:600">${esc(input.total)}</td></tr></table>
<p style="margin-top:16px;font-size:14px">${input.method === "pickup" ? `We'll have it ready for pickup${ctx.address ? ` at ${esc(ctx.address)}` : ""}. We'll let you know when it's ready.` : `We'll ship it to:<br>${esc(input.address ?? "")}`}</p>`;
  return parts(ctx, `Thanks for your order from ${ctx.businessName} (#${input.number})`, "Order received", body);
}

/** Daily note to whoever manages inventory: what is out, low, or has a count that is off. */
export function lowStockEmail(ctx: BrandCtx, input: { items: { name: string; onHand: number; onOrder: number; status: "negative" | "out" | "low" | "ok" }[]; more: number; link: string }) {
  const word = (i: (typeof input.items)[number]) => (i.status === "negative" ? `count is off (${i.onHand})` : i.status === "out" ? "out of stock" : `${i.onHand} left`) + (i.onOrder ? ` · ${i.onOrder} on order` : "");
  const rows = input.items.map((i) => `<tr><td style="padding:3px 0">${esc(i.name)}</td><td style="padding:3px 0;text-align:right;color:${i.status === "low" ? "#92400e" : "#b91c1c"}">${esc(word(i))}</td></tr>`).join("");
  const body = `<p style="margin:0 0 12px;font-size:15px">These products need a look:</p><table style="width:100%;font-size:15px;border-collapse:collapse">${rows}</table>${input.more ? `<p style="font-size:13px;color:#78716c">…and ${input.more} more.</p>` : ""}
<p style="margin-top:16px"><a href="${esc(input.link)}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:15px">See what to reorder</a></p>`;
  return { subject: `${input.items.length + input.more} product${input.items.length + input.more === 1 ? "" : "s"} to reorder · ${ctx.businessName}`, html: shell(ctx, "Low stock", body) };
}

export interface ReceiptCtx extends BrandCtx {
  number: number;
  when: string;
  clientName: string | null;
  lines: { name: string; quantity: number; amount: string }[];
  subtotal: string;
  discount: string | null;
  tax: string | null;
  tip: string | null;
  total: string;
  payments: { label: string; amount: string }[];
  refunded: string | null;
  /** "Share your code X with a friend…" when referrals are on. */
  referral?: string | null;
  /** The business's receipt footer (return policy, tax number). */
  footer?: string | null;
  /** The tax rate, e.g. "6%", shown beside the tax line. */
  taxRate?: string | null;
}

/** Itemised receipt for a closed sale. */
export function receiptEmail(r: ReceiptCtx) {
  const row = (l: string, v: string, bold = false) => `<tr><td style="padding:3px 0;${bold ? "font-weight:600" : ""}">${esc(l)}</td><td style="padding:3px 0;text-align:right;${bold ? "font-weight:600" : ""}">${esc(v)}</td></tr>`;
  const body = `<p style="color:#78716c;margin:0 0 12px">Receipt #${r.number} · ${esc(r.when)}${r.clientName ? ` · ${esc(r.clientName)}` : ""}</p>
<table style="width:100%;font-size:15px;border-collapse:collapse">
${r.lines.map((l) => row(l.quantity > 1 ? `${l.name} × ${l.quantity}` : l.name, l.amount)).join("")}
<tr><td colspan="2" style="border-top:1px solid #e7e5e4;padding-top:8px"></td></tr>
${row("Subtotal", r.subtotal)}${r.discount ? row("Discount", `-${r.discount}`) : ""}${r.tax ? row(r.taxRate ? `Tax (${r.taxRate})` : "Tax", r.tax) : ""}${r.tip ? row("Tip", r.tip) : ""}
${row("Total", r.total, true)}
<tr><td colspan="2" style="border-top:1px solid #e7e5e4;padding-top:8px"></td></tr>
${r.payments.map((p) => row(p.label, p.amount)).join("")}${r.refunded ? row("Refunded", `-${r.refunded}`) : ""}
</table>
<p style="margin-top:20px">Thank you for visiting!</p>${r.footer ? `<p style="margin-top:8px;color:#78716c;font-size:13px;white-space:pre-line">${esc(r.footer)}</p>` : ""}${r.referral ? `<p style="margin-top:12px;padding:12px;background:#f5f5f4;border-radius:8px">${esc(r.referral)}</p>` : ""}`;
  return parts(r, `Your receipt from ${r.businessName} (#${r.number})`, r.businessName, body);
}
