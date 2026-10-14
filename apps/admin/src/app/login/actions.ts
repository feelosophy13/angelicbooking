"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, SESSION_HOURS, checkPassword, clearFailures, createToken, recordFailure, throttled } from "@/lib/session";

export async function login(_prev: { error: string } | null, form: FormData): Promise<{ error: string }> {
  const h = await headers();
  const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (throttled(ip)) return { error: "Too many attempts. Try again in 15 minutes." };

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  // Run the hash check even when the email is wrong so timing doesn't reveal which half failed.
  const passwordOk = checkPassword(password, process.env.ADMIN_PASSWORD_HASH);
  const emailOk = !!process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.trim().toLowerCase();
  if (!emailOk || !passwordOk) {
    recordFailure(ip);
    return { error: "Wrong email or password." };
  }

  clearFailures(ip);
  (await cookies()).set(COOKIE, createToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}
