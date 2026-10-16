import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { verifyTurnstile } from "./turnstile";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, organization, twoFactor } from "better-auth/plugins";
import { googleEnabled } from "./auth-providers";
import { sendAuthEmail } from "@/lib/auth-email";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { nextCookies } from "better-auth/next-js";
import { eq, and, isNull } from "drizzle-orm";
import { DEFAULT_ROLE_META, DEFAULT_ROLE_PERMISSIONS, worksOwnCalendar } from "@angelic/core";
import { sql } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { formIp } from "./rate-limit";

// Organization-management permissions (invite/remove members etc.) per role.
// Business-level permissions live in @angelic/core `can()`.
const ac = createAccessControl(defaultStatements);
export const orgRoles = {
  owner: ac.newRole(ownerAc.statements),
  manager: ac.newRole(adminAc.statements),
  provider: ac.newRole(memberAc.statements),
  front_desk: ac.newRole(memberAc.statements),
};

/** The signed-in user behind the current request (hooks don't receive the actor). */
async function actingUserId(): Promise<string | null> {
  const { getSession } = await import("./session");
  const s = await getSession();
  return s?.user.id ?? null;
}

async function assertMayManageMembers(organizationId: string, userId: string | null) {
  if (!userId) throw new APIError("FORBIDDEN", { message: "Sign in to manage team members." });
  const membership = await db.query.member.findFirst({ where: and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)) });
  if (!membership) throw new APIError("FORBIDDEN", { message: "You are not a member of this business." });
  if (membership.role === "owner") return;
  const { permissionsForRole } = await import("@/server/roles");
  const perms = await permissionsForRole(organizationId, membership.role);
  if (!perms.has("members.manage")) throw new APIError("FORBIDDEN", { message: "Your role can't manage team members." });
}

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
      organizationRole: schema.organizationRole,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // Resetting a password (often because of a compromise) signs every other device out.
    revokeSessionsOnPasswordReset: true,
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
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          prompt: "select_account",
        },
      }
    : {},
  // A Google sign-in with the same (verified) email attaches to the existing account instead of creating a duplicate.
  account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
  databaseHooks: {
    account: {
      create: {
        /**
         * Google proves who owns the email. If it is being linked to an account whose email was never verified, that account may have
         * been opened by someone else with the owner's address: its password is removed and its sessions signed out, so only the real
         * owner (signing in with Google) gets in. They can set a new password from Account.
         */
        before: async (account) => {
          if (account.providerId === "credential") return;
          const u = await db.query.user.findFirst({ where: eq(schema.user.id, account.userId), columns: { emailVerified: true } });
          if (!u || u.emailVerified) return;
          await db.delete(schema.account).where(and(eq(schema.account.userId, account.userId), eq(schema.account.providerId, "credential")));
          await db.delete(schema.session).where(eq(schema.session.userId, account.userId));
        },
      },
    },
  },
  user: { changeEmail: { enabled: false } },
  // The mobile app's origins are only trusted in development (the production app has its own scheme).
  trustedOrigins: process.env.NODE_ENV === "production" ? ["angelic://"] : ["angelic://", "exp://", "http://localhost:8081"],
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  hooks: {
    // Bot check on email sign-up (Cloudflare Turnstile). The browser sends the token in a header.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return;
      const ip = ctx.headers ? formIp(ctx.headers) : null;
      if (!(await verifyTurnstile(ctx.headers?.get("x-turnstile-token"), ip))) throw new APIError("BAD_REQUEST", { message: "Please complete the check below to create your account." });
    }),
  },
  plugins: [
    organization({
      ac,
      roles: orgRoles,
      creatorRole: "owner",
      organizationLimit: 5,
      // Custom roles per business live in organization_role (Better Auth) + roles (ours).
      dynamicAccessControl: { enabled: true, maximumRolesPerOrganization: 30 },
      invitationExpiresIn: 60 * 60 * 24 * 7,
      // Accepting an invitation needs a verified email: a forwarded link alone doesn't make you that person.
      requireEmailVerificationOnInvitation: true,
      organizationHooks: {
        // Every business starts the same way, whichever endpoint created it: agreed terms, a usable address.
        beforeCreateOrganization: async ({ organization: org }) => {
          const { TERMS_VERSION } = await import("./terms");
          const { isReservedSlug } = await import("./access");
          const meta = safeParse(org.metadata);
          if (meta.termsVersion !== TERMS_VERSION) throw new APIError("BAD_REQUEST", { message: "Please agree to the Terms and Privacy Policy to continue." });
          if (isReservedSlug(org.slug ?? "")) throw new APIError("BAD_REQUEST", { message: "That business address is reserved. Please choose another name." });
        },
        // Member management is governed by our roles table (Settings → Roles), not by
        // Better Auth's static role map, so an edited built-in role is honoured here too.
        beforeCreateInvitation: async ({ invitation, inviter }) => {
          await assertMayManageMembers(invitation.organizationId, inviter.id);
        },
        beforeUpdateMemberRole: async ({ member }) => {
          await assertMayManageMembers(member.organizationId, await actingUserId());
        },
        beforeRemoveMember: async ({ member }) => {
          await assertMayManageMembers(member.organizationId, await actingUserId());
        },
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
                // Whether they work their own calendar follows the role's permissions, not its name, so a role the business made up works too.
                const { permissionsForRole } = await import("@/server/roles");
                const worksCalendar = worksOwnCalendar(await permissionsForRole(org.id, invitation.role));
                await tx.insert(schema.staff).values({
                  businessId: org.id,
                  userId: user.id,
                  displayName: user.name,
                  email: user.email,
                  bookableOnline: worksCalendar,
                  takesAppointments: worksCalendar,
                });
              }
            }
          });
        },
        afterCreateOrganization: async ({ organization: org, user }) => {
          const meta = safeParse(org.metadata);
          const { platformPriceBook } = await import("@/server/price-book");
          const trialDays = (await platformPriceBook()).trialDays;
          await db.transaction(async (tx) => {
            await tx.insert(schema.businesses).values({
              id: org.id,
              name: org.name,
              slug: org.slug,
              timezone: typeof meta.timezone === "string" ? meta.timezone : "America/New_York",
              phone: typeof meta.phone === "string" && meta.phone ? meta.phone : null,
              termsAcceptedAt: new Date(),
              termsVersion: typeof meta.termsVersion === "string" ? meta.termsVersion : null,
              // New businesses wait for a verified owner email before going public or sending anything.
              publishRequiresVerified: true,
              // The free trial starts now; its length is in the price book (Pricing page).
              trialEndsAt: new Date(Date.now() + trialDays * 86_400_000),
            });
            // Tenant rows: set RLS context inside this transaction.
            await tx.execute(sql`select set_config('app.business_id', ${org.id}, true)`);
            await tx.insert(schema.locations).values({ businessId: org.id, name: "Main location", isDefault: true });
            const [owner] = await tx
              .insert(schema.staff)
              .values({ businessId: org.id, userId: user.id, displayName: user.name, email: user.email })
              .returning({ id: schema.staff.id });
            await tx.insert(schema.roles).values(
              (["owner", "manager", "provider", "front_desk"] as const).map((key, i) => ({
                businessId: org.id,
                key,
                name: DEFAULT_ROLE_META[key].name,
                description: DEFAULT_ROLE_META[key].description,
                permissions: [...DEFAULT_ROLE_PERMISSIONS[key]],
                isSystem: true,
                sortOrder: i,
              })),
            );
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
          // A short welcome with the three things to do first (best effort: never blocks creating the business).
          void sendWelcome({ to: user.email, name: user.name, business: org.name, slug: org.slug, trialDays }).catch((e) => console.error("[welcome] failed", (e as Error).message));
        },
      },
    }),
    twoFactor({ issuer: "Angelic Booking" }),
    bearer(), // mobile: Authorization: Bearer <session token>
    nextCookies(), // must be last
  ],
});

async function sendWelcome(o: { to: string; name: string; business: string; slug: string; trialDays: number }) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
  await sendAuthEmail({
    to: o.to,
    subject: `${o.business} is set up on Angelic Booking`,
    heading: `Welcome, ${o.name.split(" ")[0]}`,
    body: `${o.business} is ready. To get your booking page live: confirm your email (we sent a separate message), add your services and your team${o.trialDays > 0 ? `, and add a card before your ${o.trialDays}-day free trial ends so nothing is interrupted` : ""}.`,
    cta: { label: "Open your calendar", url: `${base}/app/${o.slug}` },
  });
}

function safeParse(s: unknown): Record<string, unknown> {
  if (typeof s !== "string") return (s as Record<string, unknown>) ?? {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type Session = typeof auth.$Infer.Session;
