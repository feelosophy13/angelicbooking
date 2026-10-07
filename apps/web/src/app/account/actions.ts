"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";

export const updateName = formAction(z.object({ name: f.text(1, 80) }), async (d) => {
  await requireSession();
  await auth.api.updateUser({ headers: await headers(), body: { name: d.name } });
  revalidatePath("/account");
  return "Name updated";
});

export const changePassword = formAction(
  z.object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: z.string().min(8, "At least 8 characters"), confirm: z.string() }),
  async (d) => {
    await requireSession();
    if (d.newPassword !== d.confirm) throw new FormError("Passwords don't match", "confirm");
    try {
      await auth.api.changePassword({ headers: await headers(), body: { currentPassword: d.currentPassword, newPassword: d.newPassword, revokeOtherSessions: true } });
    } catch (e) {
      throw new FormError((e as Error).message.includes("INVALID") || /password/i.test((e as Error).message) ? "Current password is incorrect" : (e as Error).message, "currentPassword");
    }
    return "Password changed. Other devices were signed out.";
  },
);

export async function resendVerification() {
  const session = await requireSession();
  await auth.api.sendVerificationEmail({ headers: await headers(), body: { email: session.user.email, callbackURL: "/account" } });
  await setFlash("Verification email sent");
}

export async function revokeSession(formData: FormData) {
  await requireSession();
  const token = String(formData.get("token"));
  await auth.api.revokeSession({ headers: await headers(), body: { token } });
  await setFlash("Session signed out");
  revalidatePath("/account");
}

export async function revokeOtherSessions() {
  await requireSession();
  await auth.api.revokeOtherSessions({ headers: await headers() });
  await setFlash("All other devices signed out");
  revalidatePath("/account");
}

/** For accounts created with Google: add a password so email sign-in also works. */
export const setPassword = formAction(
  z.object({ newPassword: z.string().min(8, "At least 8 characters"), confirm: z.string() }).refine((d) => d.newPassword === d.confirm, { message: "Passwords don't match", path: ["confirm"] }),
  async (d) => {
    await auth.api.setPassword({ headers: await headers(), body: { newPassword: d.newPassword } });
    revalidatePath("/account");
    return "Password set. You can now sign in with your email and password too.";
  },
);

export async function unlinkGoogle(formData: FormData) {
  const accountId = z.string().min(1).parse(formData.get("accountId"));
  await auth.api.unlinkAccount({ headers: await headers(), body: { accountId } });
  await setFlash("Google disconnected");
  revalidatePath("/account");
}
