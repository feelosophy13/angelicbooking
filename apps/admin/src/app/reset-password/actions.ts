"use server";

import { redirect } from "next/navigation";
import { PasswordError, findAdminByEmail, setAdminPassword } from "@/lib/credentials";
import { peekEmail, verifyResetToken } from "@/lib/reset-token";
import { MIN_PASSWORD } from "@/lib/session";

export type ResetState = { error?: string } | null;

export async function resetPassword(token: string, _prev: ResetState, form: FormData): Promise<ResetState> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const peeked = peekEmail(token);
  const user = peeked ? await findAdminByEmail(peeked) : null;
  if (!secret || !user || user.disabledAt || !verifyResetToken(secret, token, user.passwordHash ?? "")) return { error: "This link has expired or was already used. Ask for a new one." };
  const password = String(form.get("password") ?? "");
  if (password.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.` };
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  try {
    await setAdminPassword(user.id, password);
  } catch (e) {
    if (e instanceof PasswordError) return { error: e.message };
    throw e;
  }
  redirect("/login?notice=reset");
}
