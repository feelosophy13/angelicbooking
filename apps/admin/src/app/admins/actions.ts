"use server";

import { revalidatePath } from "next/cache";
import { baseUrl } from "@/lib/admin-session";
import { requireAdmin } from "@/lib/admin";
import { AdminError, addAdmin, setAdminDisabled } from "@/lib/credentials";
import { sendMail } from "@/lib/mailer";
import { RESET_MINUTES, createResetToken } from "@/lib/reset-token";

export type AdminsState = { ok?: string; error?: string } | null;

/** Add an admin with no password; they get a link (works once, 30 minutes) to choose one, or can sign in with Google. */
export async function inviteAdmin(_prev: AdminsState, form: FormData): Promise<AdminsState> {
  const me = await requireAdmin();
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return { error: "ADMIN_SESSION_SECRET is not set on this service." };
  try {
    const user = await addAdmin(String(form.get("email") ?? ""), String(form.get("name") ?? ""), me.email);
    const token = createResetToken(secret, user.email, "");
    const sent = await sendMail({
      to: user.email,
      subject: "You've been added as an Angelic Booking admin",
      text: `${me.email} added you as a platform admin.\\n\\nChoose your password (the link works once and expires in ${RESET_MINUTES} minutes):\\n${baseUrl()}/reset-password?token=${encodeURIComponent(token)}\\n\\nOr sign in with Google using this email address. If you weren't expecting this, ignore it.`,
    });
    revalidatePath("/admins");
    return { ok: sent ? `Added ${user.email}. A link to choose a password was emailed.` : `Added ${user.email}, but the email could not be sent. Ask them to use "Forgot your password?" on the sign-in page.` };
  } catch (e) {
    if (e instanceof AdminError) return { error: e.message };
    throw e;
  }
}

export async function setDisabled(id: string, disabled: boolean): Promise<AdminsState> {
  const me = await requireAdmin();
  try {
    await setAdminDisabled(id, disabled, me);
    revalidatePath("/admins");
    return { ok: disabled ? "Disabled." : "Enabled." };
  } catch (e) {
    if (e instanceof AdminError) return { error: e.message };
    throw e;
  }
}
