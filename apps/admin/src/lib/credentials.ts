import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@angelic/db";
import { adminDb } from "./db";
import { checkPassword, hashPassword, MIN_PASSWORD } from "./session";

export type AdminUser = typeof schema.adminUsers.$inferSelect;

const normalize = (email: string) => email.trim().toLowerCase();

export async function findAdminByEmail(email: string): Promise<AdminUser | null> {
  const [row] = await adminDb().select().from(schema.adminUsers).where(sql`lower(${schema.adminUsers.email}) = ${normalize(email)}`);
  return row ?? null;
}

export async function findAdminById(id: string): Promise<AdminUser | null> {
  const [row] = await adminDb().select().from(schema.adminUsers).where(eq(schema.adminUsers.id, id));
  return row ?? null;
}

export async function listAdmins(): Promise<AdminUser[]> {
  return adminDb().select().from(schema.adminUsers).orderBy(schema.adminUsers.createdAt);
}

/** Emails that may sign in with Google: every enabled admin. */
export async function activeAdminEmails(): Promise<string[]> {
  const rows = await adminDb().select({ email: schema.adminUsers.email }).from(schema.adminUsers).where(isNull(schema.adminUsers.disabledAt));
  return rows.map((r) => normalize(r.email));
}

// A real hash to compare against when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = hashPassword("not-a-real-account-password");

export function passwordMatches(user: AdminUser | null, password: string): boolean {
  return checkPassword(password, user?.passwordHash ?? DUMMY_HASH) && !!user?.passwordHash;
}

/**
 * Moving off the old environment-variable login: while there are no admin accounts at all, ADMIN_EMAIL + ADMIN_PASSWORD_HASH still let that one
 * person in, and a successful sign-in creates their account so the two variables can then be deleted. Once any account exists this does nothing.
 */
export async function adoptEnvAdmin(email: string, password: string): Promise<AdminUser | null> {
  const envEmail = normalize(process.env.ADMIN_EMAIL ?? "");
  const envHash = process.env.ADMIN_PASSWORD_HASH;
  if (!envEmail || !envHash || normalize(email) !== envEmail || !checkPassword(password, envHash)) return null;
  const [any] = await adminDb().select({ id: schema.adminUsers.id }).from(schema.adminUsers).limit(1);
  if (any) return null;
  const [row] = await adminDb().insert(schema.adminUsers).values({ email: envEmail, passwordHash: envHash }).onConflictDoNothing().returning();
  return row ?? null;
}

export async function recordLogin(id: string): Promise<void> {
  await adminDb().update(schema.adminUsers).set({ lastLoginAt: new Date() }).where(eq(schema.adminUsers.id, id));
}

export class PasswordError extends Error {}

export async function setAdminPassword(userId: string, newPassword: string): Promise<void> {
  if (newPassword.length < MIN_PASSWORD) throw new PasswordError(`Use at least ${MIN_PASSWORD} characters.`);
  const user = await findAdminById(userId);
  if (!user || user.disabledAt) throw new PasswordError("This account can't be changed.");
  await adminDb().transaction(async (tx) => {
    await tx.update(schema.adminUsers).set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() }).where(eq(schema.adminUsers.id, user.id));
    await tx.insert(schema.adminAuditLog).values({ actor: user.email, action: "admin.password.reset", detail: {} });
  });
}

export class AdminError extends Error {}

/** Add an admin with no password yet; they set one from the emailed link (or sign in with Google). */
export async function addAdmin(email: string, name: string | null, actor: string): Promise<AdminUser> {
  const e = normalize(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new AdminError("Enter a valid email address.");
  if (await findAdminByEmail(e)) throw new AdminError("That email is already an admin.");
  return adminDb().transaction(async (tx) => {
    const [row] = await tx.insert(schema.adminUsers).values({ email: e, name: name?.trim() || null }).returning();
    await tx.insert(schema.adminAuditLog).values({ actor, action: "admin.add", detail: { email: e } });
    return row!;
  });
}

/** Disable or re-enable an admin. You can't disable yourself, and the last enabled admin can't be disabled. */
export async function setAdminDisabled(id: string, disabled: boolean, actor: { id: string; email: string }): Promise<void> {
  const target = await findAdminById(id);
  if (!target) throw new AdminError("Admin not found.");
  if (disabled) {
    if (target.id === actor.id) throw new AdminError("You can't disable your own account.");
    const [counted] = await adminDb().select({ n: sql<number>`count(*)::int` }).from(schema.adminUsers).where(and(isNull(schema.adminUsers.disabledAt), sql`${schema.adminUsers.id} <> ${id}`));
    if (!counted?.n) throw new AdminError("At least one admin must stay enabled.");
  }
  await adminDb().transaction(async (tx) => {
    await tx.update(schema.adminUsers).set({ disabledAt: disabled ? new Date() : null, updatedAt: new Date() }).where(eq(schema.adminUsers.id, id));
    await tx.insert(schema.adminAuditLog).values({ actor: actor.email, action: disabled ? "admin.disable" : "admin.enable", detail: { email: target.email } });
  });
}
