// Point-of-sale: sales, lines, payments, products, Stripe webhook ledger.
import { sql } from "drizzle-orm";
import { pgTable, pgEnum, text, integer, boolean, timestamp, index, uniqueIndex, check, jsonb } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { appointments, businesses, clients, staff } from "./domain";

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

export const saleStatus = pgEnum("sale_status", ["open", "paid", "refunded", "void"]);
export const saleLineKind = pgEnum("sale_line_kind", ["service", "product", "tip", "fee", "adjustment"]);
export const paymentMethod = pgEnum("payment_method", ["cash", "card", "card_on_file", "terminal", "other"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "succeeded", "failed", "refunded", "partially_refunded"]);

export const products = pgTable(
  "products",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    sku: text("sku"),
    priceCents: integer("price_cents").notNull(),
    taxable: boolean("taxable").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_business_idx").on(t.businessId, t.name)],
);

export const sales = pgTable(
  "sales",
  {
    id: id(),
    businessId: businessId(),
    // Human-friendly, per-business sequential-ish number for receipts.
    number: integer("number").notNull(),
    appointmentId: text("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    status: saleStatus("status").notNull().default("open"),
    currency: text("currency").notNull().default("usd"),
    subtotalCents: integer("subtotal_cents").notNull().default(0), // services + products before discount
    discountCents: integer("discount_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    tipCents: integer("tip_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0), // subtotal - discount + tax + tip
    paidCents: integer("paid_cents").notNull().default(0),
    refundedCents: integer("refunded_cents").notNull().default(0),
    discountNote: text("discount_note"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sales_business_created_idx").on(t.businessId, t.createdAt),
    uniqueIndex("sales_business_number_uq").on(t.businessId, t.number),
    uniqueIndex("sales_appointment_uq").on(t.appointmentId),
  ],
);

export const saleLines = pgTable(
  "sale_lines",
  {
    id: id(),
    businessId: businessId(),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    kind: saleLineKind("kind").notNull(),
    // Who earns credit for this line (commission / tips).
    staffId: text("staff_id").references(() => staff.id, { onDelete: "set null" }),
    serviceId: text("service_id"),
    productId: text("product_id"),
    appointmentItemId: text("appointment_item_id"),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitCents: integer("unit_cents").notNull(),
    amountCents: integer("amount_cents").notNull(), // quantity * unit
    taxable: boolean("taxable").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("sale_lines_sale_idx").on(t.saleId), index("sale_lines_business_staff_idx").on(t.businessId, t.staffId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    businessId: businessId(),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    method: paymentMethod("method").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    amountCents: integer("amount_cents").notNull(), // includes tipCents
    tipCents: integer("tip_cents").notNull().default(0),
    refundedCents: integer("refunded_cents").notNull().default(0),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeChargeId: text("stripe_charge_id"),
    cardBrand: text("card_brand"),
    cardLast4: text("card_last4"),
    note: text("note"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_sale_idx").on(t.saleId),
    index("payments_business_created_idx").on(t.businessId, t.createdAt),
    uniqueIndex("payments_pi_uq").on(t.stripePaymentIntentId),
    check("payments_amount_ck", sql`${t.amountCents} >= 0`),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    businessId: businessId(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason"),
    stripeRefundId: text("stripe_refund_id"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("refunds_payment_idx").on(t.paymentId)],
);

// Stripe events, keyed by event id for idempotent processing. Not tenant-scoped
// (webhooks arrive before we know the tenant), so no RLS.
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(), // Stripe event id (evt_...)
    provider: text("provider").notNull().default("stripe"),
    type: text("type").notNull(),
    accountId: text("account_id"), // connected account, if any
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("webhook_events_type_idx").on(t.type, t.receivedAt)],
);

export const SALES_TENANT_TABLES = ["products", "sales", "sale_lines", "payments", "refunds"] as const;
