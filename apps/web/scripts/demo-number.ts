/**
 * Give a demo salon a real Twilio toll-free number, so Settings → Text number and the Inbox
 * show the real thing (the number stays unverified: carrier verification is for real businesses,
 * and demo businesses never send anyway). Run from apps/web:
 *
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/demo-number.ts            # list candidates, buy nothing
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/demo-number.ts --buy      # buy the first candidate and record it
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/demo-number.ts --release  # release the demo's number at Twilio and in the database
 *
 * --slug demo-twosites picks the other demo. The number's inbound webhook points at the hosted app
 * (texts to it only reach a demo that lives in that database); the printed env lines go in .env so
 * the seed re-attaches the number after every refresh.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { purchaseNumber, releaseNumber, searchTollFree, twilioConfigured } from "../src/lib/twilio";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const SLUG = arg("--slug") ?? "demo-salon";
const BUY = process.argv.includes("--buy");
const RELEASE = process.argv.includes("--release");
/** Where Twilio posts inbound texts: the public app, since that is the only address it can reach. */
const APP = /^https:/.test(process.env.NEXT_PUBLIC_APP_URL ?? "") ? process.env.NEXT_PUBLIC_APP_URL! : "https://app.angelicbooking.com";
const envKey = (s: string) => s.toUpperCase().replace(/-/g, "_");

async function main() {
  if (!twilioConfigured()) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set.");
  if (!/^demo-/.test(SLUG)) throw new Error("Only demo businesses (slug demo-…) can be given a number here.");
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, SLUG) });
  if (!business) throw new Error(`No business with slug ${SLUG} in this database.`);
  const current = await withTenant(business.id, (tx) => tx.select().from(schema.messagingNumbers).where(and(isNull(schema.messagingNumbers.releasedAt), isNull(schema.messagingNumbers.locationId))));

  if (RELEASE) {
    for (const n of current) {
      if (n.providerSid.startsWith("PN") && !n.providerSid.startsWith("PNdemo")) await releaseNumber(n.providerSid);
      await withTenant(business.id, (tx) => tx.update(schema.messagingNumbers).set({ releasedAt: new Date(), status: "released" }).where(eq(schema.messagingNumbers.id, n.id)));
      console.log(`Released ${n.phoneNumber} (${n.providerSid})`);
    }
    if (!current.length) console.log("Nothing to release.");
    return;
  }

  const real = current.find((n) => !n.providerSid.startsWith("PNdemo"));
  if (real) {
    console.log(`${business.name} already has ${real.phoneNumber} (${real.providerSid}, ${real.status}). Use --release first to change it.`);
    return;
  }
  const candidates = await searchTollFree({ limit: 5 });
  if (!candidates.length) throw new Error("Twilio has no toll-free numbers available right now.");
  console.log("Available toll-free numbers:", candidates.map((c) => c.friendlyName).join(", "));
  if (!BUY) {
    console.log(`Dry run. Re-run with --buy to purchase ${candidates[0]!.friendlyName} for ${business.name}.`);
    return;
  }
  const bought = await purchaseNumber(candidates[0]!.phoneNumber, { friendlyName: `${business.name} (${SLUG})`, smsUrl: `${APP}/api/twilio/inbound` });
  await withTenant(business.id, async (tx) => {
    // The seed's placeholder row goes; the real number takes its place, unverified.
    for (const n of current) await tx.update(schema.messagingNumbers).set({ releasedAt: new Date(), status: "released" }).where(eq(schema.messagingNumbers.id, n.id));
    await tx.insert(schema.messagingNumbers).values({ businessId: business.id, phoneNumber: bought.phoneNumber, providerSid: bought.sid, status: "unverified" });
  });
  console.log(`Bought ${bought.phoneNumber} (${bought.sid}) for ${business.name}; inbound texts post to ${APP}/api/twilio/inbound.`);
  console.log(`Add to .env so the seed keeps it:\n${envKey(SLUG)}_TWILIO_NUMBER=${bought.phoneNumber}\n${envKey(SLUG)}_TWILIO_SID=${bought.sid}`);
  return;
}

main().then(() => process.exit(0), (e) => { console.error((e as Error).message); process.exit(1); });
