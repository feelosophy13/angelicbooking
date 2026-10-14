import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, verifyToken } from "./session";

/** Call at the top of every page and action that touches data (the proxy is only the first gate). */
export async function requireAdmin(): Promise<void> {
  const jar = await cookies();
  if (!verifyToken(jar.get(COOKIE)?.value)) redirect("/login");
}
