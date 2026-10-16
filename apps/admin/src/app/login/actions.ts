"use server";

import { cookies, headers } from "next/headers";
import { adoptEnvAdmin, findAdminByEmail, passwordMatches, recordLogin } from "@/lib/credentials";
import { startSession } from "@/lib/admin-session";
import { redirect } from "next/navigation";
import { verifyTotp } from "@/lib/totp";
import { COOKIE, clearFailures, recordFailure, throttled } from "@/lib/session";

export async function login(_prev: { error: string } | null, form: FormData): Promise<{ error: string }> {
  const h = await headers();
  const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (throttled(ip)) return { error: "Too many attempts. Try again in 15 minutes." };

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  // The hash is checked even when the email is unknown (against a dummy), so timing doesn't reveal which half failed.
  let user = await findAdminByEmail(email);
  let ok = passwordMatches(user, password) && !user?.disabledAt;
  // While no admin accounts exist yet, the old ADMIN_EMAIL / ADMIN_PASSWORD_HASH pair still works once and creates the first account.
  if (!ok && !user) {
    user = await adoptEnvAdmin(email, password);
    ok = !!user;
  }
  // When ADMIN_TOTP_SECRET is set a current authenticator code is required too. Checked last, and only after the password, so a code can't be guessed alone.
  const totpSecret = process.env.ADMIN_TOTP_SECRET;
  const codeOk = !totpSecret || (ok && verifyTotp(totpSecret, String(form.get("code") ?? "").replace(/\s/g, "")));
  if (!ok || !user || !codeOk) {
    recordFailure(ip);
    return { error: totpSecret ? "Wrong email, password or code." : "Wrong email or password." };
  }

  clearFailures(ip);
  await recordLogin(user.id);
  await startSession(user.id);
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}
