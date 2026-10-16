"use server";

import { headers } from "next/headers";
import { baseUrl } from "@/lib/admin-session";
import { findAdminByEmail } from "@/lib/credentials";
import { sendMail } from "@/lib/mailer";
import { RESET_MINUTES, createResetToken, mayRequestReset, noteResetRequest } from "@/lib/reset-token";

export type ForgotState = { done?: boolean; error?: string } | null;

/** Always answers the same way, so nobody can use this form to learn which emails are admins'. */
export async function requestReset(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  const h = await headers();
  const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!mayRequestReset(ip)) return { error: "Too many requests. Wait a minute and try again." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  noteResetRequest(ip);
  const secret = process.env.ADMIN_SESSION_SECRET;
  const user = secret && email ? await findAdminByEmail(email) : null;
  if (secret && user && !user.disabledAt) {
    const token = createResetToken(secret, user.email, user.passwordHash ?? "");
    await sendMail({
      to: email,
      subject: "Reset your Angelic admin password",
      text: `Someone asked to reset the password for the Angelic Booking platform admin.\n\nChoose a new password (the link works once and expires in ${RESET_MINUTES} minutes):\n${baseUrl()}/reset-password?token=${token}\n\nIf this wasn't you, ignore this email; nothing changes.`,
    });
  }
  return { done: true };
}
