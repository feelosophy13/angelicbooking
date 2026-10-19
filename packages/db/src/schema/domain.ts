// Tenant-owned domain tables. Every table here carries `business_id` and is
// protected by Row-Level Security (see drizzle/*_rls.sql).
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  date,
  time,
  smallint,
  index,
  uniqueIndex,
  primaryKey,
  check,
  jsonb,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

const id = () =>
  text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`)
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date());
const businessId = () =>
  text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" });

export const appointmentStatus = pgEnum("appointment_status", [
  "booked",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "no_show",
  "cancelled",
]);

export const appointmentSource = pgEnum("appointment_source", ["staff", "online", "import"]);
export const payType = pgEnum("pay_type", ["commission", "hourly", "salary"]);

// ---------------------------------------------------------------------------
// Tenant root. id === organization.id (Better Auth). Not RLS-protected itself:
// it is looked up by slug on public pages and by membership in the app.
// ---------------------------------------------------------------------------
export const businesses = pgTable("businesses", {
  id: text("id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/New_York"),
  currency: text("currency").notNull().default("usd"),
  // Last day (business-local, YYYY-MM-DD) the low-stock email went out, so it goes once a day.
  inventoryDigestOn: text("inventory_digest_on"),
  slotIntervalMin: smallint("slot_interval_min").notNull().default(15),
  phone: text("phone"),
  email: text("email"),
  // Stripe Connect (Phase 2)
  stripeAccountId: text("stripe_account_id").unique(),
  stripeChargesEnabled: boolean("stripe_charges_enabled").notNull().default(false),
  stripeDetailsSubmitted: boolean("stripe_details_submitted").notNull().default(false),
  // Sales tax applied to taxable lines, in basis points (825 = 8.25%).
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  // Online booking policy
  onlineBookingEnabled: boolean("online_booking_enabled").notNull().default(true),
  minNoticeMin: integer("min_notice_min").notNull().default(120),
  maxAdvanceDays: integer("max_advance_days").notNull().default(60),
  // Which comes first on the booking page: "provider" (choose a stylist, then a time) or "time" (choose a time, then who is free).
  bookingOrder: text("booking_order").notNull().default("provider"),
  // What "Any available provider" does when several people are free: "choose" (the client sees who), "first" (salon order), "lowest_price", "fewest_bookings" (lightest day).
  anyProviderMode: text("any_provider_mode").notNull().default("choose"),
  // A line at the bottom of printed and emailed receipts (return policy, thanks, tax number).
  receiptFooter: text("receipt_footer"),
  cancelWindowHours: integer("cancel_window_hours").notNull().default(24),
    // Late cancellation (inside the window): none, a flat amount (cents) or a percent of the booked services (bps).
    lateCancelFeeType: text("late_cancel_fee_type").notNull().default("none"), // none | flat | percent
    lateCancelFeeValue: integer("late_cancel_fee_value").notNull().default(0),
    // Whether a paid deposit counts toward the fee ("toward") or is kept on top of it ("extra").
    lateCancelDeposit: text("late_cancel_deposit").notNull().default("toward"), // toward | extra
  // When a deposit comes back (cancellation inside policy, staff refund): to the card, or as store credit.
  depositRefundAs: text("deposit_refund_as").notNull().default("original"), // original | store_credit
  // Payroll overtime when a run has it on: "weekly" (over 40 h a workweek) or "daily" (California: over 8 h a day, double over 12, seventh day).
  overtimeRule: text("overtime_rule").$type<"weekly" | "daily">().notNull().default("weekly"),
  requireCardOnline: boolean("require_card_online").notNull().default(false),
  noShowFeeCents: integer("no_show_fee_cents").notNull().default(0),
  bookingPolicy: text("booking_policy"),
  reminderHours: integer("reminder_hours").notNull().default(24),
  addressLine: text("address_line"),
  // Review requests after a completed visit
  reviewRequestEnabled: boolean("review_request_enabled").notNull().default(true),
  reviewRequestDelayHours: integer("review_request_delay_hours").notNull().default(2),
  googleReviewUrl: text("google_review_url"),
  // Loyalty points and referrals (see loyaltyLedger)
  loyaltyEnabled: boolean("loyalty_enabled").notNull().default(false),
  loyaltyPointsPerDollar: integer("loyalty_points_per_dollar").notNull().default(1),
  loyaltyPointsPerVisit: integer("loyalty_points_per_visit").notNull().default(0),
  loyaltyPointValueCents: integer("loyalty_point_value_cents").notNull().default(1), // 1 point = 1¢ when redeemed
  loyaltyMinRedeemPoints: integer("loyalty_min_redeem_points").notNull().default(500),
  referralBonusPoints: integer("referral_bonus_points").notNull().default(0), // to the referrer after the friend's first paid visit
  referralFriendBonusPoints: integer("referral_friend_bonus_points").notNull().default(0), // to the new client
  // Client accounts on the booking site (passwordless codes by email/SMS)
  clientAccountsEnabled: boolean("client_accounts_enabled").notNull().default(true),
  // Online store on the booking site
  storeEnabled: boolean("store_enabled").notNull().default(false),
  giftCardsOnline: boolean("gift_cards_online").notNull().default(true),
  shippingFlatCents: integer("shipping_flat_cents").notNull().default(0), // 0 = pickup only
  // Per-business wording for text messages; keys are template names, values use
  // {first_name} {business} {service} {staff} {when} {manage_url} {review_url} placeholders.
  smsTemplates: jsonb("sms_templates").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  // Saved replies the desk picks from in the Inbox: [{ title, body }], bodies use {first_name} {business} {next_appointment} {service} {staff}. Empty = the defaults.
  quickReplies: jsonb("quick_replies").$type<{ title: string; body: string }[]>().notNull().default(sql`'[]'::jsonb`),
  // Optional custom hostname for the public booking page (e.g. book.angelicbeauty.com).
  customDomain: text("custom_domain").unique(),
  // Where the custom domain stands: none | pending (waiting for their DNS) | active | problem | manual (needs the platform team).
  customDomainStatus: text("custom_domain_status").notNull().default("none"),
  customDomainRenderId: text("custom_domain_render_id"),
  customDomainError: text("custom_domain_error"),
  customDomainCheckedAt: timestamp("custom_domain_checked_at", { withTimezone: true }),
  // Public profile / branding shown on the booking page and in messages.
  logoUrl: text("logo_url"),
  coverUrl: text("cover_url"),
  brandColor: text("brand_color"), // #rrggbb; null = default violet
  tagline: text("tagline"),
  about: text("about"),
  website: text("website"),
  instagram: text("instagram"),
  hoursText: text("hours_text"), // free-form opening hours, one line per day
  // Platform billing (Stripe Billing on the PLATFORM account, separate from the
  // business's own Connect account). See apps/web/src/server/billing.ts.
  plan: text("plan").notNull().default("trial"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  // none | trialing | active | past_due | unpaid | canceled | incomplete | incomplete_expired | paused
  subscriptionStatus: text("subscription_status").notNull().default("none"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  // Platform admin controls (apps/admin). Suspended: the booking page and the staff app are closed.
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedReason: text("suspended_reason"),
  // Comped: the platform never charges this business (free for friends, partners, our own demo).
  comped: boolean("comped").notNull().default(false),
  // Agreed to the Terms, Privacy Policy and texting rules when creating the business (see lib/terms.ts for the version).
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsVersion: text("terms_version"),
  // New businesses stay off the public web and send no messages until the owner has verified their email. Older ones are exempt.
  publishRequiresVerified: boolean("publish_requires_verified").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const locations = pgTable(
  "locations",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    country: text("country").default("US"),
    timezone: text("timezone"), // null => inherit business timezone
    phone: text("phone"),
    // Opening hours by weekday ("0" Sunday … "6" Saturday): {open, close} or null when closed.
    // Null overall = no hours set (staff schedules alone decide availability).
    hours: jsonb("hours").$type<Record<string, { open: string; close: string } | null>>(),
    // The location is the money boundary: its own Stripe Connect account (null = the
    // business's main account) and its own sales-tax rate (null = the business default).
    // Receipts and Stripe descriptors use the location's name, address and phone.
    stripeAccountId: text("stripe_account_id"),
    stripeChargesEnabled: boolean("stripe_charges_enabled").notNull().default(false),
    stripeDetailsSubmitted: boolean("stripe_details_submitted").notNull().default(false),
    taxRateBps: integer("tax_rate_bps"),
    // Secret in the printed clock-in QR code for this site (/clock/<token>). Null until first shown.
    clockToken: text("clock_token").unique(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("locations_business_idx").on(t.businessId)],
);

// A staff member is a bookable provider. `userId` is null until they accept an invite.
export const staff = pgTable(
  "staff",
  {
    id: id(),
    businessId: businessId(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    // displayName is what clients see (a first name or nickname is fine); fullName is private, for payroll and records.
    displayName: text("display_name").notNull(),
    fullName: text("full_name"),
    email: text("email"),
    phone: text("phone"),
    color: text("color").notNull().default("#6366f1"),
    // Shown on the booking page's provider step and the staff list.
    photoUrl: text("photo_url"),
    bio: text("bio"),
    // Up to three pictures of their work, shown on the booking page's provider step.
    workPhotoUrls: text("work_photo_urls").array().notNull().default(sql`'{}'::text[]`),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }), // primary location
    // Rotating schedules: hours repeat every N weeks (1 = the same every week). `rotationAnchor` is the Monday of a
    // week that is "Week 1"; staff_schedules.week_index says which week of the cycle a row belongs to.
    rotationWeeks: smallint("rotation_weeks").notNull().default(1),
    rotationAnchor: date("rotation_anchor"),
    bookableOnline: boolean("bookable_online").notNull().default(true),
    // Has a calendar column and can be booked by staff. Off for receptionists, managers
    // and owner logins who don't take clients themselves.
    takesAppointments: boolean("takes_appointments").notNull().default(true),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    // Hash of the 4–6 digit PIN typed on the clock-in page (QR kiosk). Null = can't use the kiosk.
    clockPinHash: text("clock_pin_hash"),
    // ---- Pay configuration (see packages/core/payroll.ts). Percentages in basis points.
    position: text("position"), // e.g. Lash Artist, Esthetician, Receptionist
    payType: payType("pay_type").notNull().default("commission"),
    mainCommissionBps: integer("main_commission_bps").notNull().default(0), // 4000 = 40%
    productCommissionBps: integer("product_commission_bps").notNull().default(500), // 5%
    ccTipFeeBps: integer("cc_tip_fee_bps").notNull().default(300), // 3% of card tips
    hourlyRateCents: integer("hourly_rate_cents").notNull().default(0),
    salaryPerPeriodCents: integer("salary_per_period_cents").notNull().default(0),
    overtimeOverride: boolean("overtime_override"), // null = follow the run setting
    taxDeductionCents: integer("tax_deduction_cents"), // normally null: accountant fills in
    taxDeductionBps: integer("tax_deduction_bps"),
    // Secret for the provider's subscribable calendar feed (.ics). Rotate to revoke.
    calendarToken: text("calendar_token")
      .notNull()
      .default(sql`encode(gen_random_bytes(18), 'hex')`)
      .$defaultFn(() => randomToken()),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("staff_business_idx").on(t.businessId),
    uniqueIndex("staff_business_user_uq").on(t.businessId, t.userId),
    uniqueIndex("staff_calendar_token_uq").on(t.calendarToken),
  ],
);

// Weekly recurring template. weekday: 0 = Sunday ... 6 = Saturday. Local times.
export const staffSchedules = pgTable(
  "staff_schedules",
  {
    id: id(),
    businessId: businessId(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    // Null = the staff member's primary location, else the default. Removing a location keeps the hours.
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    // 0-based week of the staff member's rotation (always 0 when the hours repeat every week).
    weekIndex: smallint("week_index").notNull().default(0),
  },
  (t) => [
    index("staff_schedules_staff_idx").on(t.businessId, t.staffId, t.weekday),
    check("staff_schedules_weekday_ck", sql`${t.weekday} between 0 and 6`),
    check("staff_schedules_week_ck", sql`${t.weekIndex} between 0 and 3`),
    check("staff_schedules_range_ck", sql`${t.startTime} < ${t.endTime}`),
  ],
);

// Per-date override: either a day off (isOff) or custom hours.
export const staffScheduleOverrides = pgTable(
  "staff_schedule_overrides",
  {
    id: id(),
    businessId: businessId(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    isOff: boolean("is_off").notNull().default(false),
    startTime: time("start_time"),
    endTime: time("end_time"),
    note: text("note"),
  },
  (t) => [uniqueIndex("staff_overrides_uq").on(t.businessId, t.staffId, t.date)],
);

export const serviceCategories = pgTable(
  "service_categories",
  {
    id: id(),
    businessId: businessId(),
    // Nested menus: "Hair" → "Colour" → "Balayage". Null = top level.
    parentId: text("parent_id").references((): AnyPgColumn => serviceCategories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    // "Before your visit" instructions added to the confirmation and reminder for services in this
    // category (unless the service has its own).
    prepNotes: text("prep_notes"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("service_categories_business_idx").on(t.businessId), index("service_categories_parent_idx").on(t.parentId)],
);

export const services = pgTable(
  "services",
  {
    id: id(),
    businessId: businessId(),
    categoryId: text("category_id").references(() => serviceCategories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    // "Before your visit" instructions (patch test, no make-up, stop retinol …) sent with the
    // confirmation and reminder. Falls back to the category's note.
    prepNotes: text("prep_notes"),
    durationMin: smallint("duration_min").notNull(),
    // Processing/gap time after the active portion during which the staff member
    // is free to take another client (e.g. colour developing).
    gapMin: smallint("gap_min").notNull().default(0),
    // Second active block after the gap (e.g. rinse + style). 0 if none.
    finishMin: smallint("finish_min").notNull().default(0),
    bufferAfterMin: smallint("buffer_after_min").notNull().default(0),
    priceCents: integer("price_cents").notNull(),
    depositCents: integer("deposit_cents").notNull().default(0),
    // What online booking collects: a flat amount (depositCents), a percent of the price (depositPercent) or the full price.
    depositType: text("deposit_type").notNull().default("flat"), // flat | percent | full
    depositPercent: smallint("deposit_percent").notNull().default(0),
    // 1 = one client at a time. More = a class: staff schedule sessions and
    // several clients book the same session (see classSessions).
    capacity: smallint("capacity").notNull().default(1),
    bookableOnline: boolean("bookable_online").notNull().default(true),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("services_business_idx").on(t.businessId),
    check("services_duration_ck", sql`${t.durationMin} > 0`),
    check("services_capacity_ck", sql`${t.capacity} between 1 and 500`),
  ],
);

export const classSessionStatus = pgEnum("class_session_status", ["scheduled", "cancelled"]);

// A scheduled run of a group service (yoga at 6pm, lash class on Saturday).
// Blocks the instructor's calendar; clients enrol with ordinary appointments
// whose items point here, exempt from the one-client-per-slot constraint.
export const classSessions = pgTable(
  "class_sessions",
  {
    id: id(),
    businessId: businessId(),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    capacity: smallint("capacity").notNull(),
    priceCents: integer("price_cents").notNull(), // per seat, snapshot of the service price
    notes: text("notes"),
    status: classSessionStatus("status").notNull().default("scheduled"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("class_sessions_business_time_idx").on(t.businessId, t.startAt),
    index("class_sessions_staff_idx").on(t.businessId, t.staffId, t.startAt),
    check("class_sessions_range_ck", sql`${t.startAt} < ${t.endAt}`),
  ],
);

// Which staff perform which services, with optional overrides.
export const staffServices = pgTable(
  "staff_services",
  {
    businessId: businessId(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    priceCentsOverride: integer("price_cents_override"),
    durationMinOverride: smallint("duration_min_override"),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.serviceId] }), index("staff_services_business_idx").on(t.businessId)],
);

// Where a service is offered. No rows for a service = offered at every location.
export const serviceLocations = pgTable(
  "service_locations",
  {
    businessId: businessId(),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.locationId] }), index("service_locations_business_idx").on(t.businessId)],
);

export const clients = pgTable(
  "clients",
  {
    id: id(),
    businessId: businessId(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    email: text("email"),
    phone: text("phone"),
    notes: text("notes"), // general/private notes
    photoUrl: text("photo_url"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    // Cached sum of store_credit_ledger for this client.
    storeCreditCents: integer("store_credit_cents").notNull().default(0),
    // Derived: location of the most recent (non-cancelled) appointment. Clients are shared
    // across a business's locations; this only drives list filters, reports and audiences.
    homeLocationId: text("home_location_id").references(() => locations.id, { onDelete: "set null" }),
    // Appointment texts and emails (confirmations, reminders, receipts). STOP turns texts off; see sms_suppressions.
    smsOptIn: boolean("sms_opt_in").notNull().default(true),
    emailOptIn: boolean("email_opt_in").notNull().default(true),
    // Marketing (campaigns, promotional automations). Texts need the client's own written consent (TCPA), so they start off and record
    // when and how it was given; marketing email is opt-out (CAN-SPAM), and the unsubscribe link turns off only this, not appointment emails.
    smsMarketingOptIn: boolean("sms_marketing_opt_in").notNull().default(false),
    smsMarketingConsentAt: timestamp("sms_marketing_consent_at", { withTimezone: true }),
    smsMarketingConsentSource: text("sms_marketing_consent_source"),
    emailMarketingOptIn: boolean("email_marketing_opt_in").notNull().default(true),
    birthday: date("birthday"), // for birthday messages; year may be 1900 when unknown
    reviewOptOut: boolean("review_opt_out").notNull().default(false),
    // Referral programme: this client's shareable code, and who referred them.
    referralCode: text("referral_code"),
    referredByClientId: text("referred_by_client_id"),
    referralRewardedAt: timestamp("referral_rewarded_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    // When the "Reply STOP to opt out" notice was first sent, so later texts can omit it.
    smsStopNoticeAt: timestamp("sms_stop_notice_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("clients_business_idx").on(t.businessId),
    index("clients_business_phone_idx").on(t.businessId, t.phone),
    index("clients_business_name_idx").on(t.businessId, t.lastName, t.firstName),
    uniqueIndex("clients_referral_code_uq").on(t.businessId, t.referralCode),
    index("clients_birthday_idx").on(t.businessId, t.birthday),
  ],
);

// Stripe Customer per (client, connected account). A business with several locations can
// have several Stripe accounts, and a customer object only exists on one of them.
export const clientStripeCustomers = pgTable(
  "client_stripe_customers",
  {
    businessId: businessId(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    stripeAccountId: text("stripe_account_id").notNull(),
    customerId: text("customer_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.stripeAccountId] }), index("client_stripe_customers_business_idx").on(t.businessId)],
);

// ---------------------------------------------------------------------------
// Intake / consent forms
// ---------------------------------------------------------------------------
export type FormFieldType =
  | "text" | "textarea" | "number" | "date" | "phone" | "email"
  | "yesno" // "Yes" / "No"
  | "checkbox" // agreement box: must be ticked
  | "select" | "multiselect"
  | "file"
  | "initials" // the client's initials next to a paragraph of a waiver
  | "heading" // section heading, no answer
  | "statement"; // paragraph of text, no answer
/** Where an answer is copied on the client record when the form is submitted. */
export type FormFieldMapTo = "email" | "phone" | "birthday" | "notes" | "tag";
export interface FormFieldDef {
  id: string;
  type: FormFieldType;
  label: string;
  required?: boolean;
  options?: string[]; // select / multiselect
  /** Only shown (and required) when an earlier question has this answer ("true" for a ticked box, "Yes"/"No" for yes/no). */
  showIf?: { fieldId: string; equals: string } | null;
  /** Copy the answer onto the client record: contact fields, a note, or a tag (added on Yes / ticked, removed on No). */
  mapTo?: FormFieldMapTo | null;
  /** Tag name when mapTo is "tag"; defaults to the question label. */
  tag?: string | null;
}
/** One answer: text/number/date/select as string, checkbox as boolean, multiselect as string[], file as the file id. */
export type FormAnswer = string | boolean | string[];

// Pay settings over time: one row per change with the date it takes effect, so payroll for a past
// period uses the rates in force then. `staff` keeps the values in force today for display.
export const staffPayRates = pgTable(
  "staff_pay_rates",
  {
    id: id(),
    businessId: businessId(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(), // YYYY-MM-DD, salon-local
    payType: payType("pay_type").notNull(),
    mainCommissionBps: integer("main_commission_bps").notNull().default(0),
    productCommissionBps: integer("product_commission_bps").notNull().default(0),
    ccTipFeeBps: integer("cc_tip_fee_bps").notNull().default(0),
    hourlyRateCents: integer("hourly_rate_cents").notNull().default(0),
    salaryPerPeriodCents: integer("salary_per_period_cents").notNull().default(0),
    overtimeOverride: boolean("overtime_override"),
    taxDeductionCents: integer("tax_deduction_cents"),
    taxDeductionBps: integer("tax_deduction_bps"),
    note: text("note"),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("staff_pay_rates_staff_idx").on(t.businessId, t.staffId, t.effectiveFrom)],
);

export const forms = pgTable(
  "forms",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("intake"), // intake | consent
    description: text("description"),
    fields: jsonb("fields").$type<FormFieldDef[]>().notNull().default(sql`'[]'::jsonb`),
    requireSignature: boolean("require_signature").notNull().default(true),
    applyToAll: boolean("apply_to_all").notNull().default(false), // required before every visit
    serviceIds: text("service_ids").array().notNull().default(sql`'{}'::text[]`), // or only these services
    // How often a client must sign it again: null = once ever, N = every N days.
    renewDays: integer("renew_days"),
    // Required only for visits at these locations. Empty = every location.
    locationIds: text("location_ids").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("forms_business_idx").on(t.businessId)],
);

/**
 * A before or after photo from a visit. Tied to the appointment (one visit, one date, one client) and to the
 * service and stylist it shows, so the Gallery can be filtered by either. Photos of the same appointment, service
 * and stylist form a pair. Tags and the "may be shown publicly" consent are kept the same across a pair.
 * The pictures live in `files` (private kind "visit"); the thumbnail is a small copy for the Gallery grid.
 */
export const visitPhotos = pgTable(
  "visit_photos",
  {
    id: id(),
    businessId: businessId(),
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    serviceId: text("service_id").references(() => services.id, { onDelete: "set null" }),
    staffId: text("staff_id").references(() => staff.id, { onDelete: "set null" }),
    phase: text("phase").notNull(), // "before" | "after"
    fileId: text("file_id").notNull(),
    thumbFileId: text("thumb_file_id"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    // The client agreed the salon may show these photos publicly (portfolio, social media).
    shareOk: boolean("share_ok").notNull().default(false),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("visit_photos_appointment_idx").on(t.appointmentId),
    index("visit_photos_gallery_idx").on(t.businessId, t.takenAt),
    index("visit_photos_client_idx").on(t.businessId, t.clientId),
    index("visit_photos_service_idx").on(t.businessId, t.serviceId),
    index("visit_photos_staff_idx").on(t.businessId, t.staffId),
  ],
);

export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: id(),
    businessId: businessId(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    appointmentId: text("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    answers: jsonb("answers").$type<Record<string, FormAnswer>>().notNull().default(sql`'{}'::jsonb`),
    signatureName: text("signature_name"),
    // Drawn signature (PNG in `files`), when the client signed with their finger.
    signatureFileId: text("signature_file_id"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    // Staff member who completed it with the client at the front desk (null = client's own device).
    assistedByUserId: text("assisted_by_user_id"),
    // Snapshot of the form as it was signed, so later edits don't change the record.
    formSnapshot: jsonb("form_snapshot").$type<{ name: string; fields: FormFieldDef[]; description: string | null }>(),
    // Voided submissions stay on file for the audit trail but no longer count as "on file".
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: text("voided_by_user_id"),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("form_submissions_client_idx").on(t.businessId, t.clientId, t.createdAt), index("form_submissions_appointment_idx").on(t.appointmentId)],
);

// ---------------------------------------------------------------------------
// Reviews requested after a visit
// ---------------------------------------------------------------------------
export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    appointmentId: text("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    staffId: text("staff_id").references(() => staff.id, { onDelete: "set null" }),
    // Where the visit took place, copied from the appointment when the request is queued so
    // the review can be filtered and reported even after the appointment is gone.
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    token: text("token")
      .notNull()
      .default(sql`encode(gen_random_bytes(18), 'hex')`)
      .$defaultFn(() => randomToken()),
    rating: smallint("rating"), // 1..5, null until submitted
    comment: text("comment"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reviews_token_uq").on(t.token),
    index("reviews_business_location_idx").on(t.businessId, t.locationId),
    uniqueIndex("reviews_appointment_uq").on(t.appointmentId),
    index("reviews_business_idx").on(t.businessId, t.submittedAt),
    check("reviews_rating_ck", sql`${t.rating} is null or (${t.rating} between 1 and 5)`),
  ],
);

// ---------------------------------------------------------------------------
// Loyalty points ledger (balance = sum of deltas)
// ---------------------------------------------------------------------------
/**
 * Store credit: money the business owes a client (a refund kept in-house, a goodwill credit). Spent at
 * checkout as a "store_credit" payment. The balance is cached on the client row and kept in step here.
 */
export const storeCreditLedger = pgTable(
  "store_credit_ledger",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Positive = credit issued, negative = credit used. */
    deltaCents: integer("delta_cents").notNull(),
    reason: text("reason").notNull(), // refund | deposit_refund | payment | payment_refund | adjust
    saleId: text("sale_id"),
    paymentId: text("payment_id"),
    appointmentId: text("appointment_id"),
    /** For reason = refund: the managed refund reason (refund_reasons.id). */
    refundReasonId: text("refund_reason_id"),
    note: text("note"),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("store_credit_client_idx").on(t.businessId, t.clientId, t.createdAt)],
);

export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(), // earn | redeem | adjust | referral | referral_friend
    saleId: text("sale_id"),
    note: text("note"),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("loyalty_ledger_client_idx").on(t.businessId, t.clientId, t.createdAt), uniqueIndex("loyalty_ledger_sale_reason_uq").on(t.saleId, t.reason).where(sql`${t.reason} in ('earn','referral','referral_friend','refund')`)],
);

// ---------------------------------------------------------------------------
// Client sign-in codes for the booking-site account (passwordless)
// ---------------------------------------------------------------------------
export const clientLoginCodes = pgTable(
  "client_login_codes",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // email | sms
    destination: text("destination").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: smallint("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("client_login_codes_client_idx").on(t.businessId, t.clientId, t.createdAt)],
);

// Timestamped, attributed notes on a client (formulas, allergies, preferences).
export const clientNotes = pgTable(
  "client_notes",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("client_notes_client_idx").on(t.businessId, t.clientId, t.createdAt)],
);

type LashSetJson = { length: number | null; curl: string | null; thickness: number | null; type?: string | null };
type LashZoneJson = LashSetJson & { spike?: LashSetJson | null };

// How a stylist sets a client's lash extensions: 6 or 7 zones from the inner to the outer corner, each with length, curl and
// thickness. A client keeps every map they've had, newest first; the visit it was made at is optional.
export const lashMaps = pgTable(
  "lash_maps",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    appointmentId: text("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    title: text("title").notNull(), // the style: "Natural cat eye", "Doll eye volume"
    // A spike is the setting on the divider after a zone; type is Classic, Hybrid or a volume fan (see @angelic/core lash-map).
    zones: jsonb("zones").$type<LashZoneJson[]>().notNull(), // both eyes, or the left eye when rightZones is set
    rightZones: jsonb("right_zones").$type<LashZoneJson[]>(), // only when the right eye is set differently
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("lash_maps_client_idx").on(t.businessId, t.clientId, t.createdAt)],
);

// A standing appointment ("every 4 weeks with Maria"). Each occurrence is a
// normal appointment row pointing back here, so the calendar, checkout and
// notifications need no special cases.
export const appointmentSeries = pgTable(
  "appointment_series",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    serviceId: text("service_id").references(() => services.id, { onDelete: "set null" }),
    staffId: text("staff_id").references(() => staff.id, { onDelete: "set null" }),
    intervalWeeks: smallint("interval_weeks").notNull(),
    firstStartAt: timestamp("first_start_at", { withTimezone: true }).notNull(),
    occurrences: smallint("occurrences").notNull(), // planned, including the first
    notes: text("notes"),
    endedAt: timestamp("ended_at", { withTimezone: true }), // set when the remaining visits are cancelled
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("appointment_series_business_idx").on(t.businessId, t.clientId)],
);

export const depositStatus = pgEnum("deposit_status", ["none", "paid", "applied", "refunded"]);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    businessId: businessId(),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    status: appointmentStatus("status").notNull().default("booked"),
    source: appointmentSource("source").notNull().default("staff"),
    // visit (a client appointment) | block (blocked time: lunch, late start, "do not book"; no client, no checkout)
    kind: text("kind").notNull().default("visit"),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    // The managed reason picked at cancel time (cancellation_reasons.id), who cancelled, and whether it fell inside the cancellation window.
    cancellationReasonId: text("cancellation_reason_id"),
    cancelledBy: text("cancelled_by"), // staff | client | system
    cancelledLate: boolean("cancelled_late"),
    // Secret for the client's self-service page (cancel / reschedule). Unguessable.
    manageToken: text("manage_token")
      .notNull()
      .default(sql`encode(gen_random_bytes(18), 'hex')`)
      .$defaultFn(() => randomToken()),
    seriesId: text("series_id").references(() => appointmentSeries.id, { onDelete: "set null" }),
    // Deposit collected at online booking on the business's Stripe account.
    // "paid" until a sale is opened for the appointment (then the deposit becomes
    // a payment on that sale: "applied"), or until it is refunded.
    depositCents: integer("deposit_cents").notNull().default(0),
    depositStatus: depositStatus("deposit_status").notNull().default("none"),
    // Online bookings: the cancellation policy as the client saw it, when they agreed by booking, and from which address.
    policyText: text("policy_text"),
    policyAcceptedAt: timestamp("policy_accepted_at", { withTimezone: true }),
    policyAcceptedIp: text("policy_accepted_ip"),
    depositPaymentIntentId: text("deposit_payment_intent_id"),
    /** The Stripe account that took the deposit, so a refund goes to the right one even after the location's account changes. */
    depositStripeAccountId: text("deposit_stripe_account_id"),
    depositCardLabel: text("deposit_card_label"), // "VISA •••• 4242"
    // SetupIntent that saved a card on file at booking (no money moved).
    cardSetupIntentId: text("card_setup_intent_id"),
    // Promo code entered online; applied as the discount when checkout opens.
    promoCodeId: text("promo_code_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("appointments_business_idx").on(t.businessId),
    index("appointments_client_idx").on(t.businessId, t.clientId),
    uniqueIndex("appointments_manage_token_uq").on(t.manageToken),
    uniqueIndex("appointments_deposit_pi_uq").on(t.depositPaymentIntentId),
    index("appointments_series_idx").on(t.seriesId),
  ],
);

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("hex");
}

export const notificationChannel = pgEnum("notification_channel", ["email", "sms"]);
export const notificationStatus = pgEnum("notification_status", ["queued", "sending", "sent", "failed", "skipped", "cancelled"]);

// A business's own SMS sender number (toll-free, bought through the platform's
// Twilio account). One active (unreleased) number per business. Messages go out
// from it once carrier verification is approved; until then SMS is skipped.
export const messagingNumberStatus = pgEnum("messaging_number_status", [
  "unverified", // bought, verification not yet submitted
  "pending_review", // submitted to Twilio/carriers
  "in_review",
  "verified",
  "rejected",
  "released",
]);

export const messagingNumbers = pgTable(
  "messaging_numbers",
  {
    id: id(),
    businessId: businessId(),
    phoneNumber: text("phone_number").notNull(), // E.164
    providerSid: text("provider_sid").notNull().unique(), // Twilio IncomingPhoneNumber SID (PN…)
    // Null = the business's main number (every location without its own). A location that is a
    // separate business can have its own: texts about visits there go out from it.
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    numberType: text("number_type").notNull().default("toll_free"),
    status: messagingNumberStatus("status").notNull().default("unverified"),
    verificationSid: text("verification_sid"), // Twilio Tollfree Verification SID (HH…)
    verificationSubmittedAt: timestamp("verification_submitted_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    rejectionDetails: jsonb("rejection_details").$type<unknown[]>(),
    editAllowed: boolean("edit_allowed").notNull().default(false),
    // Snapshot of the submitted verification form, so it can be edited and resubmitted.
    verification: jsonb("verification").$type<Record<string, string>>(),
    // Billing hook: the monthly add-on price at purchase time and when billing should
    // start. Charged by the platform subscription once Stripe billing is enabled.
    monthlyFeeCents: integer("monthly_fee_cents").notNull().default(0),
    billingStartsAt: timestamp("billing_starts_at", { withTimezone: true }),
    // Stripe subscription item (si_…) carrying the monthly number fee, while active.
    stripeItemId: text("stripe_item_id"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).defaultNow().notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("messaging_numbers_active_idx").on(t.businessId).where(sql`released_at is null`),
    index("messaging_numbers_status_idx").on(t.status),
  ],
);

// Outbound messages to clients and staff. Rows are created immediately and
// delivered either right away (after the response) or by the jobs route.
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    appointmentId: text("appointment_id").references(() => appointments.id, { onDelete: "cascade" }),
    // Which location the message is about (picks the sender number). Null = business-wide.
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    channel: notificationChannel("channel").notNull(),
    template: text("template").notNull(), // confirmation | reminder | cancellation | rescheduled | receipt | invite
    recipient: text("recipient").notNull(),
    subject: text("subject"),
    body: text("body").notNull(), // rendered text (sms) or html (email)
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).defaultNow().notNull(),
    // Set when a delivery run claims the row (status -> "sending"). Rows stuck in
    // "sending" past a timeout are reclaimed by the next run.
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    status: notificationStatus("status").notNull().default("queued"),
    // Delivery attempts so far; a failed send is re-queued with backoff until MAX_ATTEMPTS.
    attempts: integer("attempts").notNull().default(0),
    providerId: text("provider_id"),
    // Carrier-reported outcome of a text (Twilio status callback): queued | sent | delivered | undelivered | failed. Null for email and until the first callback.
    deliveryStatus: text("delivery_status"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // Pictures attached to an outgoing text (MMS): [{ url, type }], public addresses Twilio fetches.
    media: jsonb("media").$type<{ url: string; type: string }[]>().notNull().default(sql`'[]'::jsonb`),
    error: text("error"),
    campaignId: text("campaign_id"),
    // Set when a workflow step queued this message (Marketing → Automations), for the "why did this send" trail.
    workflowRunId: text("workflow_run_id"),
    // A campaign or promotional automation: needs marketing consent when it is sent, not only when it was queued.
    marketing: boolean("marketing").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_due_idx").on(t.status, t.scheduledAt),
    index("notifications_appointment_idx").on(t.appointmentId),
    index("notifications_business_idx").on(t.businessId, t.createdAt),
    index("notifications_provider_idx").on(t.providerId),
  ],
);

// Hours for hourly staff: manual entries or clock in/out.
export const timeEntries = pgTable(
  "time_entries",
  {
    id: id(),
    businessId: businessId(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    date: date("date").notNull(), // local calendar date the hours belong to
    minutes: integer("minutes").notNull().default(0),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }), // where they clocked in
    clockInAt: timestamp("clock_in_at", { withTimezone: true }),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
    note: text("note"),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("time_entries_staff_date_idx").on(t.businessId, t.staffId, t.date), check("time_entries_minutes_ck", sql`${t.minutes} >= 0`)],
);

// One-off pay lines for a period (training pay, transfers, corrections).
export const payrollAdjustments = pgTable(
  "payroll_adjustments",
  {
    id: id(),
    businessId: businessId(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    label: text("label").notNull(),
    amountCents: integer("amount_cents").notNull(),
    // Pay for the work (a bonus, commission paid by hand): counts toward the overtime regular rate. Reimbursements don't.
    countsAsPay: boolean("counts_as_pay").notNull().default(false),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("payroll_adjustments_period_idx").on(t.businessId, t.periodStart, t.periodEnd)],
);

export const payrollRunStatus = pgEnum("payroll_run_status", ["draft", "finalized"]);

// A finalized pay period: the computed result is frozen as JSON for the record.
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: id(),
    businessId: businessId(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: payrollRunStatus("status").notNull().default("finalized"),
    overtime: boolean("overtime").notNull().default(false),
    snapshot: jsonb("snapshot").notNull(),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payroll_runs_period_uq").on(t.businessId, t.periodStart, t.periodEnd)],
);

export const waitlistStatus = pgEnum("waitlist_status", ["open", "booked", "closed"]);

export const waitlist = pgTable(
  "waitlist",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    serviceId: text("service_id").references(() => services.id, { onDelete: "set null" }),
    staffId: text("staff_id").references(() => staff.id, { onDelete: "set null" }),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    notes: text("notes"),
    status: waitlistStatus("status").notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [index("waitlist_business_date_idx").on(t.businessId, t.status, t.date)],
);

// One row per (service, staff) within an appointment. The time range is what
// blocks the staff member's calendar. `status` mirrors the parent appointment
// so the DB-level exclusion constraint can ignore cancelled / no-show items.
export const appointmentItems = pgTable(
  "appointment_items",
  {
    id: id(),
    businessId: businessId(),
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    serviceId: text("service_id").references(() => services.id, { onDelete: "set null" }),
    serviceName: text("service_name").notNull(), // snapshot at booking time
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    priceCents: integer("price_cents").notNull(),
    status: appointmentStatus("status").notNull().default("booked"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Set for a seat in a class session; such items share the session's time
    // and are excluded from the staff double-booking constraint.
    classSessionId: text("class_session_id").references(() => classSessions.id, { onDelete: "set null" }),
    // Imported history (and deliberately double-booked imports) may overlap; also
    // exempt from the constraint. Never set by the app's own booking paths.
    allowOverlap: boolean("allow_overlap").notNull().default(false),
  },
  (t) => [
    index("appointment_items_staff_time_idx").on(t.businessId, t.staffId, t.startAt),
    index("appointment_items_business_time_idx").on(t.businessId, t.startAt),
    index("appointment_items_appointment_idx").on(t.appointmentId),
    index("appointment_items_class_session_idx").on(t.classSessionId),
    check("appointment_items_range_ck", sql`${t.startAt} < ${t.endAt}`),
  ],
);

// Roles a business can assign to logins. `key` is stored in Better Auth's member.role.
// Built-in roles are seeded per business and can be edited; "owner" is locked.
export const roles = pgTable(
  "roles",
  {
    id: id(),
    businessId: businessId(),
    key: text("key").notNull(), // e.g. owner, manager, provider, front_desk, senior_stylist
    name: text("name").notNull(),
    description: text("description"),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    isSystem: boolean("is_system").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roles_business_key_uq").on(t.businessId, t.key)],
);

// Keys for the public REST API (/api/v1). Only the SHA-256 of the key is stored; the key itself is shown once at creation.
// RLS: rows are tenant-scoped like every other table, plus a SELECT-only lookup policy that matches one row by hash
// (app.api_key_hash), because the business is not known until the key has been found.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    // First characters of the key, so the list can tell keys apart ("ab_live_k3Fq"). Not secret.
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    // e.g. clients:read, appointments:write (see lib/api-scopes.ts). A write scope implies its read scope.
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    // 1 = made before the finer scopes (expanded on use, see lib/api-scopes.ts); 2 = scopes are exact.
    scopeVersion: smallint("scope_version").notNull().default(1),
    // Empty = any address; otherwise only these (exact addresses or IPv4 CIDR ranges).
    allowedIps: text("allowed_ips").array().notNull().default(sql`'{}'::text[]`),
    // Requests per minute; null = the default.
    rateLimitPerMin: integer("rate_limit_per_min"),
    createdByUserId: text("created_by_user_id"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_business_idx").on(t.businessId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    businessId: businessId(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    diff: text("diff"), // JSON
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_log_business_idx").on(t.businessId, t.at)],
);

// ---------------------------------------------------------------------------
// Marketing: campaigns, automations, promo codes
// ---------------------------------------------------------------------------
export interface CampaignAudience {
  /** Visited within the last N days */
  visitedWithinDays?: number | null;
  /** Last visit at least N days ago (lapsed) */
  lapsedDays?: number | null;
  /** Has had this service */
  serviceId?: string | null;
  /** Has seen this staff member */
  staffId?: string | null;
  /** Has this tag */
  tag?: string | null;
  /** Never completed a visit */
  neverVisited?: boolean | null;
  /** Home location (last seen at) */
  locationId?: string | null;
}

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    channel: notificationChannel("channel").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    audience: jsonb("audience").$type<CampaignAudience>().notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("draft"), // draft | sent
    recipientCount: integer("recipient_count").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaigns_business_idx").on(t.businessId, t.createdAt)],
);

export const automationKind = pgEnum("automation_kind", ["birthday", "win_back", "rebook", "pre_visit"]);

// Automated messages: birthday, "we miss you" after N days, rebook reminder N days after a visit.
export const automations = pgTable(
  "automations",
  {
    id: id(),
    businessId: businessId(),
    kind: automationKind("kind").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    channel: text("channel").notNull().default("email"), // email | sms | both
    days: integer("days").notNull().default(60), // win_back: days since last visit; rebook: days after visit
    hoursBefore: integer("hours_before").notNull().default(48), // pre_visit: hours before the appointment
    subject: text("subject"),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("automations_business_kind_uq").on(t.businessId, t.kind)],
);

export const automationSends = pgTable(
  "automation_sends",
  {
    id: id(),
    businessId: businessId(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(), // birthday: year; win_back/rebook: appointment id
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("automation_sends_uq").on(t.automationId, t.clientId, t.periodKey)],
);

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: id(),
    businessId: businessId(),
    code: text("code").notNull(), // stored upper-case
    type: text("type").notNull(), // percent | amount
    value: integer("value").notNull(), // percent (10) or cents (1000)
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    usesCount: integer("uses_count").notNull().default(0),
    serviceIds: text("service_ids").array().notNull().default(sql`'{}'::text[]`), // empty = any service
    minSubtotalCents: integer("min_subtotal_cents").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("promo_codes_business_code_uq").on(t.businessId, t.code)],
);

// ---------------------------------------------------------------------------
// Inbound text messages (replies to the business's number)
// ---------------------------------------------------------------------------
export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    fromNumber: text("from_number").notNull(),
    toNumber: text("to_number").notNull(),
    body: text("body").notNull(),
    providerSid: text("provider_sid").unique(),
    // Picture/file attachments (MMS): [{ url, type }] as Twilio sent them.
    media: jsonb("media").$type<{ url: string; type: string }[]>().notNull().default(sql`'[]'::jsonb`),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("inbound_messages_business_idx").on(t.businessId, t.receivedAt), index("inbound_messages_client_idx").on(t.clientId)],
);

// ---------------------------------------------------------------------------
// Uploaded files (logos, cover photos, product images). Served by id from
// /api/files/<id>; ids are unguessable so no RLS is applied on reads.
// ---------------------------------------------------------------------------
export const files = pgTable(
  "files",
  {
    id: id(),
    businessId: businessId(),
    kind: text("kind").notNull(), // logo | cover | product | form (client upload) | signature
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    // Where the bytes live: "db" (the data column) or "r2" (object storage under storageKey).
    storage: text("storage").notNull().default("db"),
    storageKey: text("storage_key"),
    data: customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" })("data"),
    createdAt: createdAt(),
  },
  (t) => [index("files_business_idx").on(t.businessId), index("files_storage_key_idx").on(t.storageKey)],
);

// ---------------------------------------------------------------------------
// Workflows: trigger → filters → ordered steps. Replaces the fixed automations
// (which stay in `automations` only until their rows are converted). Guardrails
// (consent, quiet hours, once per occasion, stop on rebook) live in code, not here.
// ---------------------------------------------------------------------------
export type WorkflowTrigger =
  | "appointment_booked"
  | "appointment_completed"
  | "appointment_cancelled"
  | "appointment_no_show"
  | "client_created"
  | "birthday"
  | "no_visit"
  | "form_submitted"
  | "review_submitted"
  | "membership_payment_failed";

export interface WorkflowFilters {
  /** Only visits that include one of these services / categories (categories include their sub-categories). */
  serviceIds?: string[];
  categoryIds?: string[];
  locationIds?: string[];
  staffIds?: string[];
  /** Client must carry one of these tags. */
  tags?: string[];
  /** review_submitted: rating range (1..5). */
  minRating?: number | null;
  maxRating?: number | null;
  /** appointment_* / client_created: only the client's first completed or booked visit. */
  firstVisitOnly?: boolean;
  /** appointment_*: only appointments the client booked online (not ones the desk entered or imported). */
  onlineOnly?: boolean;
  /** no_visit: days since the last completed visit. */
  days?: number | null;
}

export type WorkflowStep =
  | { id: string; type: "wait"; mode: "delay" | "before_appointment" | "after_appointment"; hours: number }
  | { id: string; type: "sms"; body: string }
  | { id: string; type: "email"; subject: string; body: string; ctaLabel?: string | null }
  | { id: string; type: "review_request" }
  // The standard appointment reminder (details, manage link, forms, prep) on every channel the client allows.
  | { id: string; type: "reminder" }
  | { id: string; type: "tag"; tag: string }
  | { id: string; type: "points"; points: number; note?: string | null }
  | { id: string; type: "notify_staff"; to: "owner" | "provider"; body: string };

export const workflows = pgTable(
  "workflows",
  {
    id: id(),
    businessId: businessId(),
    // Set for the pre-built templates every business gets (pre_visit, rebook, …); null for custom workflows.
    templateKey: text("template_key"),
    name: text("name").notNull(),
    description: text("description"),
    trigger: text("trigger").$type<WorkflowTrigger>().notNull(),
    enabled: boolean("enabled").notNull().default(false),
    filters: jsonb("filters").$type<WorkflowFilters>().notNull().default(sql`'{}'::jsonb`),
    steps: jsonb("steps").$type<WorkflowStep[]>().notNull().default(sql`'[]'::jsonb`),
    // Stop the sequence as soon as the client books again (rebook / win-back style flows).
    exitOnBooking: boolean("exit_on_booking").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    // Birthday / no-visit workflows: the local day the daily scan last finished, so it runs once a day instead of every 5 minutes.
    lastScanOn: date("last_scan_on"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("workflows_business_trigger_idx").on(t.businessId, t.trigger), uniqueIndex("workflows_business_template_uq").on(t.businessId, t.templateKey)],
);

// "failed": a step threw (the error is the last log line); the cron leaves it alone and carries on with the other runs.
export type WorkflowRunStatus = "active" | "done" | "cancelled" | "failed";
export interface WorkflowRunContext {
  appointmentId?: string | null;
  locationId?: string | null;
  staffId?: string | null;
  serviceIds?: string[];
  categoryIds?: string[];
  rating?: number | null;
  formId?: string | null;
  membershipId?: string | null;
  /** Human-readable reason the run started, e.g. "Appointment completed". */
  reason?: string;
}
export interface WorkflowRunLogEntry {
  at: string; // ISO
  step: number | null;
  // "queued" when a step hands a message to delivery; "sent" / "skipped" / "failed" are what delivery then did with it (appended by
  // lib/notify when the message is tried), so the log says what actually went out.
  event: "started" | "waiting" | "queued" | "sent" | "skipped" | "failed" | "action" | "cancelled" | "done";
  detail: string;
}

// One client going through one workflow. `dedupeKey` makes each occasion fire once
// (an appointment id, a birthday year, a lapse period …).
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: id(),
    businessId: businessId(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    appointmentId: text("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").$type<WorkflowRunStatus>().notNull().default("active"),
    stepIndex: integer("step_index").notNull().default(0),
    // When the run should be looked at next (null = immediately / finished).
    nextAt: timestamp("next_at", { withTimezone: true }),
    context: jsonb("context").$type<WorkflowRunContext>().notNull().default(sql`'{}'::jsonb`),
    log: jsonb("log").$type<WorkflowRunLogEntry[]>().notNull().default(sql`'[]'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("workflow_runs_dedupe_uq").on(t.workflowId, t.dedupeKey),
    index("workflow_runs_due_idx").on(t.businessId, t.status, t.nextAt),
    index("workflow_runs_appointment_idx").on(t.appointmentId),
    index("workflow_runs_client_idx").on(t.clientId),
  ],
);

/** Names of every table guarded by tenant RLS. Used by the RLS migration and tests. */
export const TENANT_TABLES = [
  "locations",
  "staff",
  "staff_pay_rates",
  "staff_schedules",
  "staff_schedule_overrides",
  "service_categories",
  "services",
  "staff_services",
  "clients",
  "appointments",
  "appointment_items",
  "audit_log",
  "products",
  "sales",
  "sale_lines",
  "payments",
  "refunds",
  "refund_reasons",
  "cancellation_reasons",
  "store_credit_ledger",
  "notifications",
  "waitlist",
  "time_entries",
  "payroll_adjustments",
  "payroll_runs",
  "gift_cards",
  "packages",
  "client_packages",
  "membership_plans",
  "client_memberships",
  "import_jobs",
  "product_categories",
  "roles",
  "client_notes",
  "appointment_series",
  "class_sessions",
  "forms",
  "form_submissions",
  "reviews",
  "loyalty_ledger",
  "client_login_codes",
  "campaigns",
  "automations",
  "automation_sends",
  "workflows",
  "workflow_runs",
  "promo_codes",
  "inbound_messages",
  "stock_movements",
  "product_stock",
  "suppliers",
  "product_groups",
  "inventory_pins",
  "product_barcodes",
  "purchase_orders",
  "purchase_order_lines",
  "api_keys",
] as const;

/**
 * Numbers that must not be texted by this business: a STOP reply, or the carrier reporting the person opted out (Twilio 21610). Keyed by
 * the last ten digits so every client record sharing the number (family members, duplicates) and any client added later is covered.
 * START removes the row.
 */
export const smsSuppressions = pgTable(
  "sms_suppressions",
  {
    businessId: businessId(),
    phoneTail: text("phone_tail").notNull(),
    source: text("source").notNull(), // stop | carrier | staff
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.phoneTail] })],
);

/** Platform jobs that run once a day: the last day each one ran (claimed atomically, so a slow or late 5-minute run never skips a day). */
export const jobMarkers = pgTable("job_markers", {
  name: text("name").primaryKey(),
  lastRunOn: date("last_run_on").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
