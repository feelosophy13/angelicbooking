import "server-only";
import { cookies } from "next/headers";
import { COOKIE, SESSION_HOURS, createToken } from "./session";

/** Start a signed-in session (password or Google). */
export async function startSession(): Promise<void> {
  (await cookies()).set(COOKIE, createToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export function baseUrl(): string {
  return (process.env.ADMIN_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "");
}
