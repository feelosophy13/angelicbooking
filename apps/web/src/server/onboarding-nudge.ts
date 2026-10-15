/**
 * One reminder email to people who signed up and never created a business: they confirmed their email, a day or more has
 * passed (not more than a week), and they have no membership anywhere. Sent once (user.onboarding_nudged_at).
 */
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { sendAuthEmail } from "@/lib/auth-email";

export async function nudgeAbandonedSignups(limit = 20): Promise<{ checked: number; sent: number }> {
  const now = Date.now();
  const rows = await db
    .select({ id: schema.user.id, email: schema.user.email, name: schema.user.name })
    .from(schema.user)
    .where(
      and(
        eq(schema.user.emailVerified, true),
        isNull(schema.user.onboardingNudgedAt),
        lte(schema.user.createdAt, new Date(now - 24 * 3_600_000)),
        gte(schema.user.createdAt, new Date(now - 7 * 86_400_000)),
        sql`not exists (select 1 from member m where m.user_id = ${schema.user.id})`,
      ),
    )
    .limit(limit);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
  let sent = 0;
  for (const u of rows) {
    // Mark first: a failed send is not retried, so nobody is emailed twice.
    await db.update(schema.user).set({ onboardingNudgedAt: new Date() }).where(eq(schema.user.id, u.id));
    try {
      await sendAuthEmail({
        to: u.email,
        subject: "Finish setting up your booking page",
        heading: `Hi ${u.name.split(" ")[0]}, you're one step away`,
        body: "You created an Angelic Booking account but haven't set up your business yet. It takes about a minute: add your business name and you can start adding services and your team.",
        cta: { label: "Set up my business", url: `${base}/onboarding` },
      });
      sent++;
    } catch (e) {
      console.error("[nudge] failed", u.id, (e as Error).message);
    }
  }
  return { checked: rows.length, sent };
}
