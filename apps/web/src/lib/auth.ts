import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { sql } from "drizzle-orm";
import { db, schema } from "@angelic/db";

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
    },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  plugins: [
    organization({
      creatorRole: "owner",
      organizationLimit: 5,
      organizationHooks: {
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
