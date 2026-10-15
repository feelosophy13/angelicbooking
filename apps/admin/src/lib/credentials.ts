import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@angelic/db";
import { adminDb } from "./db";
import { checkPassword, hashPassword, MIN_PASSWORD } from "./session";

/** The password hash in force: the one saved by a reset if there is one, else ADMIN_PASSWORD_HASH. Needs no login (used by it). */
export async function currentHash(): Promise<string> {
  try {
    const [row] = await adminDb().select({ hash: schema.adminCredentials.passwordHash }).from(schema.adminCredentials).where(eq(schema.adminCredentials.id, "admin"));
    if (row) return row.hash;
  } catch (e) {
    // The table is missing until migration 0079 has run; fall back to the environment so nobody is locked out.
    console.error("[admin] could not read admin_credentials:", (e as Error).message);
  }
  return process.env.ADMIN_PASSWORD_HASH ?? "";
}

export function adminEmail(): string {
  return (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
}

export async function passwordMatches(password: string): Promise<boolean> {
  return checkPassword(password, await currentHash());
}

export class PasswordError extends Error {}

export async function setAdminPassword(newPassword: string): Promise<void> {
  if (newPassword.length < MIN_PASSWORD) throw new PasswordError(`Use at least ${MIN_PASSWORD} characters.`);
  const passwordHash = hashPassword(newPassword);
  const email = adminEmail();
  await adminDb().transaction(async (tx) => {
    await tx.insert(schema.adminCredentials).values({ id: "admin", email, passwordHash }).onConflictDoUpdate({ target: schema.adminCredentials.id, set: { email, passwordHash, updatedAt: new Date() } });
    await tx.insert(schema.adminAuditLog).values({ actor: email || "admin", action: "admin.password.reset", detail: {} });
  });
}
