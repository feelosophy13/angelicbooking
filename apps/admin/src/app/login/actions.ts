"use server";

import { cookies, headers } from "next/headers";
import { adminEmail, passwordMatches } from "@/lib/credentials";
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
  // Run the hash check even when the email is wrong so timing doesn't reveal which half failed.
  const passwordOk = await passwordMatches(password);
  const emailOk = !!adminEmail() && email === adminEmail();
  // When ADMIN_TOTP_SECRET is set a current authenticator code is required too. Checked last, and only after the password, so a code can't be guessed alone.
  const totpSecret = process.env.ADMIN_TOTP_SECRET;
  const codeOk = !totpSecret || (emailOk && passwordOk && verifyTotp(totpSecret, String(form.get("code") ?? "").replace(/\s/g, "")));
  if (!emailOk || !passwordOk || !codeOk) {
    recordFailure(ip);
    return { error: totpSecret ? "Wrong email, password or code." : "Wrong email or password." };
  }

  clearFailures(ip);
  await startSession();
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}
