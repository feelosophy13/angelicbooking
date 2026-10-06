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
    bookableOnline: boolean("bookable_online").notNull().default(true),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("appointments_business_idx").on(t.businessId),
    index("appointments_client_idx").on(t.businessId, t.clientId),
  ],
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
] as const;
