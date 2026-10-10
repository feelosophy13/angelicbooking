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
  cancelWindowHours: integer("cancel_window_hours").notNull().default(24),
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
  // Optional custom hostname for the public booking page (e.g. book.angelicbeauty.com).
  customDomain: text("custom_domain").unique(),
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
    displayName: text("display_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    color: text("color").notNull().default("#6366f1"),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }), // primary location
    bookableOnline: boolean("bookable_online").notNull().default(true),
    // Has a calendar column and can be booked by staff. Off for receptionists, managers
    // and owner logins who don't take clients themselves.
    takesAppointments: boolean("takes_appointments").notNull().default(true),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
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
    locationId: text("location_id").references(() => locations.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [
    index("staff_schedules_staff_idx").on(t.businessId, t.staffId, t.weekday),
    check("staff_schedules_weekday_ck", sql`${t.weekday} between 0 and 6`),
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
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("service_categories_business_idx").on(t.businessId)],
);

export const services = pgTable(
  "services",
  {
    id: id(),
    businessId: businessId(),
    categoryId: text("category_id").references(() => serviceCategories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMin: smallint("duration_min").notNull(),
    // Processing/gap time after the active portion during which the staff member
    // is free to take another client (e.g. colour developing).
    gapMin: smallint("gap_min").notNull().default(0),
    // Second active block after the gap (e.g. rinse + style). 0 if none.
    finishMin: smallint("finish_min").notNull().default(0),
    bufferAfterMin: smallint("buffer_after_min").notNull().default(0),
    priceCents: integer("price_cents").notNull(),
    depositCents: integer("deposit_cents").notNull().default(0),
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
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    // Stripe customer on the BUSINESS's connected account (Phase 2)
    stripeCustomerId: text("stripe_customer_id"),
    smsOptIn: boolean("sms_opt_in").notNull().default(true),
    emailOptIn: boolean("email_opt_in").notNull().default(true),
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

// ---------------------------------------------------------------------------
// Intake / consent forms
// ---------------------------------------------------------------------------
export type FormFieldType = "text" | "textarea" | "checkbox" | "select" | "date" | "statement";
export interface FormFieldDef {
  id: string;
  type: FormFieldType;
  label: string;
  required?: boolean;
  options?: string[]; // select
}

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
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("forms_business_idx").on(t.businessId)],
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
    answers: jsonb("answers").$type<Record<string, string | boolean>>().notNull().default(sql`'{}'::jsonb`),
    signatureName: text("signature_name"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    // Snapshot of the form as it was signed, so later edits don't change the record.
    formSnapshot: jsonb("form_snapshot").$type<{ name: string; fields: FormFieldDef[]; description: string | null }>(),
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
    uniqueIndex("reviews_appointment_uq").on(t.appointmentId),
    index("reviews_business_idx").on(t.businessId, t.submittedAt),
    check("reviews_rating_ck", sql`${t.rating} is null or (${t.rating} between 1 and 5)`),
  ],
);

// ---------------------------------------------------------------------------
// Loyalty points ledger (balance = sum of deltas)
// ---------------------------------------------------------------------------
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
  (t) => [index("loyalty_ledger_client_idx").on(t.businessId, t.clientId, t.createdAt), uniqueIndex("loyalty_ledger_sale_reason_uq").on(t.saleId, t.reason)],
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
    notes: text("notes"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
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
    depositPaymentIntentId: text("deposit_payment_intent_id"),
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
    providerId: text("provider_id"),
    error: text("error"),
    campaignId: text("campaign_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_due_idx").on(t.status, t.scheduledAt),
    index("notifications_appointment_idx").on(t.appointmentId),
    index("notifications_business_idx").on(t.businessId, t.createdAt),
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
    kind: text("kind").notNull(), // logo | cover | product
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    data: customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" })("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("files_business_idx").on(t.businessId)],
);

/** Names of every table guarded by tenant RLS. Used by the RLS migration and tests. */
export const TENANT_TABLES = [
  "locations",
  "staff",
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
  "promo_codes",
  "inbound_messages",
  "stock_movements",
] as const;
