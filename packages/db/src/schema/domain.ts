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
  // Platform billing
  plan: text("plan").notNull().default("trial"),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("staff_business_idx").on(t.businessId),
    uniqueIndex("staff_business_user_uq").on(t.businessId, t.userId),
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
    bookableOnline: boolean("bookable_online").notNull().default(true),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("services_business_idx").on(t.businessId),
    check("services_duration_ck", sql`${t.durationMin} > 0`),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("clients_business_idx").on(t.businessId),
    index("clients_business_phone_idx").on(t.businessId, t.phone),
    index("clients_business_name_idx").on(t.businessId, t.lastName, t.firstName),
  ],
);

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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("appointments_business_idx").on(t.businessId),
    index("appointments_client_idx").on(t.businessId, t.clientId),
    uniqueIndex("appointments_manage_token_uq").on(t.manageToken),
  ],
);

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("hex");
}

export const notificationChannel = pgEnum("notification_channel", ["email", "sms"]);
export const notificationStatus = pgEnum("notification_status", ["queued", "sent", "failed", "skipped", "cancelled"]);

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
    sentAt: timestamp("sent_at", { withTimezone: true }),
    status: notificationStatus("status").notNull().default("queued"),
    providerId: text("provider_id"),
    error: text("error"),
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
  },
  (t) => [
    index("appointment_items_staff_time_idx").on(t.businessId, t.staffId, t.startAt),
    index("appointment_items_business_time_idx").on(t.businessId, t.startAt),
    index("appointment_items_appointment_idx").on(t.appointmentId),
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
] as const;
