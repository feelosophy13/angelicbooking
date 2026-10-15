/**
 * One-time move of the old price environment variables into the database price book (platform_pricing), which the admin
 * app edits and everything now reads. Does nothing if a price book already exists. Usage (from the repo root):
 *   BILLING_BASE_CENTS=0 SMS_NUMBER_MONTHLY_FEE_CENTS=1500 SMS_USAGE_CENTS=2 pnpm --filter @angelic/db seed:price-book [--dry-run]
 * --dry-run only prints what would be saved. Needs DATABASE_ADMIN_URL (the owner role), read from the root .env.
 */
import "./env";
import postgres from "postgres";
import { DEFAULT_PRICE_BOOK, type PriceBook } from "../../core/src/platform-pricing";

const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
};

const book: PriceBook = {
  ...DEFAULT_PRICE_BOOK,
  baseCents: num("BILLING_BASE_CENTS", DEFAULT_PRICE_BOOK.baseCents),
  numberCents: num("SMS_NUMBER_MONTHLY_FEE_CENTS", DEFAULT_PRICE_BOOK.numberCents),
  smsUsageCents: num("SMS_USAGE_CENTS", DEFAULT_PRICE_BOOK.smsUsageCents),
  smsIncluded: num("SMS_INCLUDED_PER_MONTH", DEFAULT_PRICE_BOOK.smsIncluded),
  trialDays: num("BILLING_TRIAL_DAYS", DEFAULT_PRICE_BOOK.trialDays),
  platformFeeBps: num("PLATFORM_FEE_BPS", DEFAULT_PRICE_BOOK.platformFeeBps),
};

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is not set");
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const [existing] = await sql`select id from platform_pricing where id = 'default'`;
  if (existing) {
    console.log("A price book already exists; nothing to do.");
  } else {
    console.log("Price book to save:", book);
    if (process.argv.includes("--dry-run")) console.log("(dry run: nothing saved)");
    else {
      await sql`
        insert into platform_pricing (id, base_cents, included_locations, per_location_cents, included_staff, per_staff_cents, number_cents, sms_included, sms_usage_cents, trial_days, platform_fee_bps)
        values ('default', ${book.baseCents}, ${book.includedLocations}, ${book.perLocationCents}, ${book.includedStaff}, ${book.perStaffCents}, ${book.numberCents}, ${book.smsIncluded}, ${book.smsUsageCents}, ${book.trialDays}, ${book.platformFeeBps})
        on conflict (id) do nothing`;
      await sql`insert into admin_audit_log (actor, action, detail) values ('system', 'pricing.default.seed', ${sql.json({ after: { ...book } })})`;
      console.log("Saved.");
    }
  }
} finally {
  await sql.end();
}
