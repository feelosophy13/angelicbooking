import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findAdminById, type AdminUser } from "./credentials";
import { COOKIE, tokenUserId } from "./session";

/**
 * Call at the top of every page and action that touches data (the proxy is only the first gate). Checks the cookie, then that the
 * account still exists and is enabled, so disabling an admin signs them out on their next click. Returns who is signed in.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const jar = await cookies();
  const id = tokenUserId(jar.get(COOKIE)?.value);
  const user = id ? await findAdminById(id) : null;
  if (!user || user.disabledAt) redirect("/login");
  return user;
}
