import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, organization, twoFactor } from "better-auth/plugins";
import { sendAuthEmail } from "@/lib/auth-email";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { nextCookies } from "better-auth/next-js";
import { eq, and, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, schema } from "@angelic/db";

// Organization-management permissions (invite/remove members etc.) per role.
// Business-level permissions live in @angelic/core `can()`.
const ac = createAccessControl(defaultStatements);
export const orgRoles = {
  owner: ac.newRole(ownerAc.statements),
  manager: ac.newRole(adminAc.statements),
  provider: ac.newRole(memberAc.statements),
  front_desk: ac.newRole(memberAc.statements),
};

/**
 * Better Auth owns users, sessions, organizations and memberships.
 * An organization IS a tenant; the `businesses` table extends it 1:1 and is
 * created in the afterCreateOrganization hook so the two can never drift.
 */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
      twoFactor: schema.twoFactor,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({ to: user.email, subject: "Reset your Angelic Booking password", heading: "Reset your password", body: "Someone (hopefully you) asked to reset the password for this account. The link expires in one hour.", cta: { label: "Choose a new password", url } });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({ to: user.email, subject: "Verify your email for Angelic Booking", heading: `Welcome, ${user.name.split(" ")[0]}`, body: "Please confirm this is your email address so we can send you account notices and password resets.", cta: { label: "Verify email", url } });
    },
  },
  user: { changeEmail: { enabled: false } },
  trustedOrigins: ["angelic://", "exp://", "http://localhost:8081"],
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  plugins: [
    organization({
      ac,
      roles: orgRoles,
      creatorRole: "owner",
      organizationLimit: 5,
      invitationExpiresIn: 60 * 60 * 24 * 7,
      organizationHooks: {
        // When an invitee joins, attach them to the staff row created for their
        // email (or create one) so they appear on the calendar.
        afterAcceptInvitation: async ({ invitation, user, organization: org }) => {
          await db.transaction(async (tx) => {
            await tx.execute(sql`select set_config('app.business_id', ${org.id}, true)`);
            const existing = await tx.query.staff.findFirst({
              where: and(eq(schema.staff.email, invitation.email.toLowerCase()), isNull(schema.staff.userId)),
            });
            if (existing) {
              const placeholder = existing.displayName === invitation.email.split("@")[0];
              await tx
                .update(schema.staff)
                .set({ userId: user.id, displayName: placeholder ? user.name : existing.displayName })
                .where(eq(schema.staff.id, existing.id));
            } else {
              const already = await tx.query.staff.findFirst({ where: eq(schema.staff.userId, user.id) });
              if (!already) {
                await tx.insert(schema.staff).values({
                  businessId: org.id,
                  userId: user.id,
                  displayName: user.name,
                  email: user.email,
                  bookableOnline: invitation.role === "provider",
                });
              }
            }
          });
        },
        afterCreateOrganization: async ({ organization: org, user }) => {
          const meta = safeParse(org.metadata);
          await db.transaction(async (tx) => {
            await tx.insert(schema.businesses).values({
              id: org.id,
              name: org.name,
              slug: org.slug,
              timezone: typeof meta.timezone === "string" ? meta.timezone : "America/New_York",
            });
            // Tenant rows: set RLS context inside this transaction.
            await tx.execute(sql`select set_config('app.business_id', ${org.id}, true)`);
            await tx.insert(schema.locations).values({ businessId: org.id, name: "Main location", isDefault: true });
            const [owner] = await tx
              .insert(schema.staff)
              .values({ businessId: org.id, userId: user.id, displayName: user.name, email: user.email })
              .returning({ id: schema.staff.id });
            // Default hours Tue–Sat 9–5 so the owner is bookable immediately; editable under Staff.
            await tx.insert(schema.staffSchedules).values(
              [2, 3, 4, 5, 6].map((weekday) => ({
                businessId: org.id,
                staffId: owner!.id,
                weekday,
                startTime: "09:00",
                endTime: "17:00",
              })),
            );
          });
        },
      },
    }),
    twoFactor({ issuer: "Angelic Booking" }),
    bearer(), // mobile: Authorization: Bearer <session token>
    nextCookies(), // must be last
  ],
});

function safeParse(s: unknown): Record<string, unknown> {
  if (typeof s !== "string") return (s as Record<string, unknown>) ?? {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type Session = typeof auth.$Infer.Session;
