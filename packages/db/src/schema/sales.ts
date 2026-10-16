// Point-of-sale: sales, lines, payments, products, Stripe webhook ledger.
import { sql } from "drizzle-orm";
import { pgTable, pgEnum, text, integer, boolean, timestamp, index, uniqueIndex, check, jsonb } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { appointments, businesses, clients, locations, staff } from "./domain";

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
export const saleLineKind = pgEnum("sale_line_kind", ["service", "product", "tip", "fee", "adjustment", "gift_card", "package", "membership"]);
export const paymentMethod = pgEnum("payment_method", ["cash", "card", "card_on_file", "terminal", "other", "gift_card", "loyalty", "store_credit"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "succeeded", "failed", "refunded", "partially_refunded"]);

export const productCategories = pgTable(
  "product_categories",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("product_categories_business_idx").on(t.businessId)],
);

/** Who a business buys retail and back-bar products from. */
export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    accountNumber: text("account_number"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("suppliers_business_idx").on(t.businessId, t.name)],
);

/**
 * A product that comes in options (sizes, shades). The group holds what the options share: name, category, kind, photo, description,
 * tax, the online store and the usual supplier. Each option is a products row (its own price, cost, SKU, barcode, stock and levels)
 * whose `name`, category and the rest are kept equal to the group's, so everything that works on a product works on an option.
 */
export const productGroups = pgTable(
  "product_groups",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    categoryId: text("category_id").references(() => productCategories.id, { onDelete: "set null" }),
    kind: text("kind").notNull().default("retail"),
    taxable: boolean("taxable").notNull().default(true),
    sellOnline: boolean("sell_online").notNull().default(false),
    supplierId: text("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("product_groups_business_idx").on(t.businessId, t.name)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    businessId: businessId(),
    categoryId: text("category_id").references(() => productCategories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    sku: text("sku"),
    // What a scanner reads (EAN/UPC); the register and receiving find a product by it.
    barcode: text("barcode"),
    // Sold in options (a size, a shade): the option's label ("250 ml", "7N / 50 ml"), and the group it belongs to.
    variantLabel: text("variant_label"),
    groupId: text("group_id").references(() => productGroups.id, { onDelete: "set null" }),
    // retail: sold to clients. backbar: used up in services (stock is tracked, never sold).
    kind: text("kind").notNull().default("retail"),
    priceCents: integer("price_cents").notNull(),
    taxable: boolean("taxable").notNull().default(true),
    active: boolean("active").notNull().default(true),
    // Online store
    sellOnline: boolean("sell_online").notNull().default(false),
    description: text("description"),
    imageUrl: text("image_url"),
    // Inventory
    trackStock: boolean("track_stock").notNull().default(false),
    stockQty: integer("stock_qty").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
    // Reorder suggestions bring the count back up to this (blank: twice the low-stock level).
    reorderUpTo: integer("reorder_up_to"),
    supplierId: text("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    costCents: integer("cost_cents").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_business_idx").on(t.businessId, t.name), index("products_barcode_idx").on(t.businessId, t.barcode), index("products_group_idx").on(t.groupId)],
);

/** More barcodes for one product (a case, a different pack size, a re-labelled item). A scan of one adds `unitsPerScan` units. products.barcode stays the main one. */
export const productBarcodes = pgTable(
  "product_barcodes",
  {
    id: id(),
    businessId: businessId(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    unitsPerScan: integer("units_per_scan").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("product_barcodes_code_uq").on(t.businessId, t.code), index("product_barcodes_product_idx").on(t.productId)],
);

/** On-hand quantity of a product at one location. products.stock_qty is always the sum across locations. */
export const productStock = pgTable(
  "product_stock",
  {
    id: id(),
    businessId: businessId(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull().default(0),
  },
  (t) => [uniqueIndex("product_stock_uq").on(t.productId, t.locationId), index("product_stock_business_idx").on(t.businessId, t.locationId)],
);

/** The products a person keeps at the top of Log usage. Per person, so a shared tablet shows each stylist their own. */
export const inventoryPins = pgTable(
  "inventory_pins",
  {
    id: id(),
    businessId: businessId(),
    userId: text("user_id").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inventory_pins_uq").on(t.userId, t.productId)],
);

export const purchaseOrderStatus = pgEnum("purchase_order_status", ["draft", "ordered", "partial", "received", "cancelled"]);

/** An order to a supplier. Receiving it (all or part at a time) adds the stock and updates the unit cost. */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    businessId: businessId(),
    number: integer("number").notNull(),
    supplierId: text("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    // Where the delivery goes (and so where the received stock is counted).
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    status: purchaseOrderStatus("status").notNull().default("draft"),
    expectedOn: text("expected_on"), // YYYY-MM-DD
    orderedAt: timestamp("ordered_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    reference: text("reference"), // the supplier's invoice / confirmation number
    notes: text("notes"),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("purchase_orders_number_uq").on(t.businessId, t.number), index("purchase_orders_status_idx").on(t.businessId, t.status)],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: id(),
    businessId: businessId(),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    orderedQty: integer("ordered_qty").notNull(),
    receivedQty: integer("received_qty").notNull().default(0),
    unitCostCents: integer("unit_cost_cents").notNull().default(0),
  },
  (t) => [uniqueIndex("purchase_order_lines_uq").on(t.purchaseOrderId, t.productId)],
);

// Every change to on-hand stock: received, sold, used, adjusted, counted, returned, written off, transferred.
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    businessId: businessId(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    // received | sale | return | used | adjust | count | damage | theft | expired | lost | supplier_return | transfer_in | transfer_out | opening
    reason: text("reason").notNull(),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    saleId: text("sale_id"),
    // Supplies a staff member logged against a visit.
    appointmentId: text("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    purchaseOrderId: text("purchase_order_id"),
    // A movement that undoes another one (a logged use taken back); an original can be taken back only once.
    reversesMovementId: text("reverses_movement_id"),
    // What one unit cost when it moved, so cost of goods sold and supplies used don't shift when prices later change.
    unitCostCents: integer("unit_cost_cents"),
    note: text("note"),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_movements_product_idx").on(t.businessId, t.productId, t.createdAt),
    index("stock_movements_business_created_idx").on(t.businessId, t.createdAt),
    // A sale takes stock once per product (and back-bar use once), however often it is closed again.
    uniqueIndex("stock_movements_sale_product_uq").on(t.saleId, t.productId, t.reason).where(sql`${t.reason} in ('sale', 'used')`),
    uniqueIndex("stock_movements_reverses_uq").on(t.reversesMovementId).where(sql`${t.reversesMovementId} is not null`),
  ],
);

export const sales = pgTable(
  "sales",
  {
    id: id(),
    businessId: businessId(),
    // Human-friendly, per-business sequential-ish number for receipts.
    number: integer("number").notNull(),
    appointmentId: text("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    // Where the money was taken: decides the Stripe account, tax rate and receipt identity.
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
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
    // Private note on the ticket ("gift for Maria", "price matched"); never printed on the receipt.
    notes: text("notes"),
    // No sales tax on this ticket (resale or exempt client); decided at the desk, per ticket.
    taxExempt: boolean("tax_exempt").notNull().default(false),
    // The discount as entered ("percent" 10 or "amount" 500), so it re-applies when lines change.
    discountType: text("discount_type"), // amount | percent
    discountValue: integer("discount_value"),
    promoCodeId: text("promo_code_id"),
    // pos (staff checkout) | online (store / gift card purchase on the booking site) | membership (auto-renewal)
    source: text("source").notNull().default("pos"),
    // Online orders: how the goods reach the client.
    fulfillment: jsonb("fulfillment").$type<{ method: "pickup" | "ship"; name?: string; email?: string; phone?: string; address?: string; message?: string; status?: "pending" | "ready" | "done" }>(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sales_business_created_idx").on(t.businessId, t.createdAt),
    index("sales_business_location_idx").on(t.businessId, t.locationId),
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
    // A service line covered by a package session or membership credit: what covered it and
    // what it was worth, so cross-location redemptions can be reported.
    clientPackageId: text("client_package_id"),
    clientMembershipId: text("client_membership_id"),
    creditCents: integer("credit_cents").notNull().default(0),
    // A tip line only: how it was handed over, "cash" or "card". Null = same as the payment (older tips, or the desk did not say); payroll splits those by the payment mix.
    tipMethod: text("tip_method"),
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
    giftCardId: text("gift_card_id"), // method = gift_card
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

/** Why refunds happen, managed per business under Settings → Payments (seeded with defaults). */
export const refundReasons = pgTable(
  "refund_reasons",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("refund_reasons_business_idx").on(t.businessId, t.sortOrder)],
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
    /** Free-text note (the "reason" column predates the managed list). */
    reason: text("reason"),
    reasonId: text("reason_id").references(() => refundReasons.id, { onDelete: "set null" }),
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

// ---------------------------------------------------------------------------
// Gift cards, packages, memberships
// ---------------------------------------------------------------------------
export const giftCards = pgTable(
  "gift_cards",
  {
    id: id(),
    businessId: businessId(),
    code: text("code").notNull(),
    initialCents: integer("initial_cents").notNull(),
    balanceCents: integer("balance_cents").notNull(),
    purchaserClientId: text("purchaser_client_id").references(() => clients.id, { onDelete: "set null" }),
    recipientName: text("recipient_name"),
    saleId: text("sale_id").references(() => sales.id, { onDelete: "set null" }),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }), // sold at
    // Where it can be spent. Empty = any location of the business.
    validLocationIds: text("valid_location_ids").array().notNull().default(sql`'{}'::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("gift_cards_business_code_uq").on(t.businessId, t.code), check("gift_cards_balance_ck", sql`${t.balanceCents} >= 0`)],
);

// A prepaid bundle of sessions; serviceId null = usable on any service.
export const packages = pgTable(
  "packages",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    serviceId: text("service_id"),
    sessions: integer("sessions").notNull(),
    priceCents: integer("price_cents").notNull(),
    validDays: integer("valid_days"), // null = never expires
    description: text("description"),
    imageUrl: text("image_url"),
    // Where sessions can be redeemed. Empty = any location of the business.
    validLocationIds: text("valid_location_ids").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("packages_business_idx").on(t.businessId)],
);

export const clientPackages = pgTable(
  "client_packages",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "restrict" }),
    serviceId: text("service_id"), // null = any service
    remaining: integer("remaining").notNull(),
    saleId: text("sale_id").references(() => sales.id, { onDelete: "set null" }),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }), // sold at
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("client_packages_client_idx").on(t.businessId, t.clientId), check("client_packages_remaining_ck", sql`${t.remaining} >= 0`)],
);

// Recurring plan: a price per billing period (every N weeks / months / years) that includes
// N sessions of a service and/or a discount.
export const membershipPlans = pgTable(
  "membership_plans",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull(),
    // Billing cadence: every `intervalCount` × `interval` (week | month | year).
    interval: text("interval").notNull().default("month"),
    intervalCount: integer("interval_count").notNull().default(1),
    includedServiceId: text("included_service_id"),
    includedSessions: integer("included_sessions").notNull().default(0), // per period
    // Unused sessions that may carry into the next period (0 = none carry over).
    rolloverCap: integer("rollover_cap").notNull().default(0),
    // Fixed-length plans end after this many billed periods; null = ongoing until cancelled.
    cycleCount: integer("cycle_count"),
    discountBps: integer("discount_bps").notNull().default(0), // off other services
    description: text("description"),
    // Where credits and discounts can be used. Empty = any location of the business.
    validLocationIds: text("valid_location_ids").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    // Stripe price on the BUSINESS's connected account, created on first auto-renew setup.
    stripePriceId: text("stripe_price_id"),
    createdAt: createdAt(),
  },
  (t) => [index("membership_plans_business_idx").on(t.businessId)],
);

// paused = frozen on purpose (frozenUntil set) or waiting on a failed card; ended = fixed-length plan ran its course.
export const membershipStatus = pgEnum("membership_status", ["active", "paused", "cancelled", "ended"]);

export const clientMemberships = pgTable(
  "client_memberships",
  {
    id: id(),
    businessId: businessId(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => membershipPlans.id, { onDelete: "restrict" }),
    status: membershipStatus("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    creditsRemaining: integer("credits_remaining").notNull().default(0),
    // Periods paid for so far (the sale counts as the first); fixed-length plans stop at plan.cycleCount.
    cyclesBilled: integer("cycles_billed").notNull().default(1),
    // A freeze: no charges and no credits until frozenUntil, then the membership resumes on its own.
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    frozenUntil: timestamp("frozen_until", { withTimezone: true }),
    // Sold at: the renewal subscription lives on this location's Stripe account.
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    stripeSubscriptionId: text("stripe_subscription_id"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    lastInvoiceId: text("last_invoice_id"),
    paymentFailedAt: timestamp("payment_failed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("client_memberships_client_idx").on(t.businessId, t.clientId), uniqueIndex("client_memberships_sub_uq").on(t.stripeSubscriptionId)],
);

// Data imports (Vagaro CSV / XLSX).
export const importJobs = pgTable(
  "import_jobs",
  {
    id: id(),
    businessId: businessId(),
    kind: text("kind").notNull(), // clients | services | appointments
    filename: text("filename").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    mapping: jsonb("mapping").notNull().default(sql`'{}'::jsonb`),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("import_jobs_business_idx").on(t.businessId, t.createdAt)],
);
