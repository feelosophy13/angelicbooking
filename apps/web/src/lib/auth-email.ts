import { emailConfigured, sendEmail } from "@/lib/notify/providers";

/**
 * Transactional auth mail (verification, password reset). Not tenant-scoped.
 * Falls back to logging the link when no email provider is configured, so the
 * flows can be exercised locally.
 */
export async function sendAuthEmail(input: { to: string; subject: string; heading: string; body: string; cta: { label: string; url: string } }) {
  const html = `<!doctype html><html><body style="margin:0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#faf9f7;padding:24px;color:#1c1917">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;overflow:hidden">
<div style="background:#6d28d9;padding:14px 24px;color:#fff;font-weight:600">Angelic Booking</div>
<div style="padding:24px"><h1 style="font-size:20px;margin:0 0 12px">${input.heading}</h1><p style="font-size:15px;line-height:1.5">${input.body}</p>
<p style="margin-top:16px"><a href="${input.cta.url}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">${input.cta.label}</a></p>
<p style="font-size:12px;color:#78716c">If the button doesn't work, paste this link into your browser:<br>${input.cta.url}</p></div></div></body></html>`;
  if (!emailConfigured()) {
    console.log(`[auth-email] ${input.subject} → ${input.to}\n  ${input.cta.url}`);
    return;
  }
  await sendEmail({ to: input.to, subject: input.subject, html });
}
