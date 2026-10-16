// Platform-level tables: what we charge businesses and what platform admins did.
// Written only by apps/admin (role angelic_admin); apps/web may read pricing, never write it.
import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { businesses } from "./domain";

const priceColumns = {
  baseCents: integer("base_cents"),
  includedLocations: integer("included_locations"),
  perLocationCents: integer("per_location_cents"),
  includedStaff: integer("included_staff"),
  perStaffCents: integer("per_staff_cents"),
  numberCents: integer("number_cents"),
  smsIncluded: integer("sms_included"),
  smsUsageCents: integer("sms_usage_cents"),
  trialDays: integer("trial_days"),
  // Platform fee on each card payment the business takes, in basis points (100 = 1%).
  platformFeeBps: integer("platform_fee_bps"),
  // Emails per day a business may send before it has a subscription (0 = no limit).
  trialEmailCap: integer("trial_email_cap"),
};

/** The default price book. A single row, id = 'default'; every column is filled in. */
export const platformPricing = pgTable("platform_pricing", {
  id: text("id").primaryKey().default("default"),
  ...priceColumns,
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Per-business overrides of the default price book. A null column means "use the default". */
export const businessPricing = pgTable("business_pricing", {
  businessId: text("business_id")
    .primaryKey()
    .references(() => businesses.id, { onDelete: "cascade" }),
  ...priceColumns,
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Append-only record of what platform admins changed. No FK on business so it outlives the business. */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    businessId: text("business_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("admin_audit_log_at_idx").on(t.at), index("admin_audit_log_business_idx").on(t.businessId)],
);

/** Superseded by admin_users (migration 0091); kept so old rows survive. Nothing reads it any more. */
export const adminCredentials = pgTable("admin_credentials", {
  id: text("id").primaryKey().default("admin"),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * People who can sign in to the platform admin app. Passwords are hashed here (scrypt); `password_hash` is null until an invited admin
 * sets one from the emailed link, and Google sign-in needs only the (verified) email. Disabled admins keep their row for the audit trail.
 */
export const adminUsers = pgTable(
  "admin_users",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("password_hash"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("admin_users_email_uq").on(sql`lower(${t.email})`)],
);

/**
 * Fixed-window request counters shared by every web instance (API keys, failed API logins). Not tenant data, so no RLS: the app writes
 * one row per key and window, and the rows expire on their own (see lib/rate-limit.ts).
 */
export const apiRateLimits = pgTable("api_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});
