import "server-only";
import { cookies } from "next/headers";
import { COOKIE, createToken, sessionCookieOptions } from "./session";

/** Start a signed-in session (password or Google). */
export async function startSession(): Promise<void> {
  (await cookies()).set(COOKIE, createToken(), sessionCookieOptions(process.env.NODE_ENV === "production"));
}

export function baseUrl(): string {
  return (process.env.ADMIN_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "");
}
