/**
 * Invoices: a bill a salon sends a client to pay online (a bridal party, an event, a balance owed, a deposit for a big job).
 *
 * An invoice is an ordinary open sale (source "invoice") with an invoices row attached. The sale holds the lines, the discount, tax and
 * the payments, and goes through the same code as a ticket at the desk, so once it is paid it is a paid sale: reports, payroll
 * commission, tips, loyalty and refunds see nothing different. The invoices row adds what only an invoice has: the client's link (an
 * unguessable token), the due date, the note, the deposit asked for now, and when it was sent, opened and reminded.
 *
 * The client pays on /book/<slug>/invoice/<token> through the business's processor: a PaymentIntent on its Stripe account (charged at
 * once, no stock hold: products leave stock when the sale is paid off, like a ticket), or a HelcimPay.js purchase. Part payments are
 * ordinary payments on the sale; the one that pays it off closes it. Receipts go to the client (and a note to the business) once per
 * payment, whoever records it first: the page, the Stripe webhook or the sweep.
 */
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { db, schema, withJobs, withTenant, type TenantDb } from "@angelic/db";
import { instantToISODate, normalizePhone, type Discount } from "@angelic/core";
import { appUrl, stripe } from "@/lib/stripe";
import { browserStripe } from "@/lib/stripe-demo";
import { queueOneOff } from "@/lib/notify";
import { invoiceEmail, invoicePaymentEmail, receiptEmail, transactionalEmail, type BrandCtx } from "@/lib/notify/templates";
import { siteUrl } from "@/lib/site-url";
import { formatMoney, shiftISODate } from "@/lib/utils";
import { paymentMethodLabel } from "@/lib/payment-methods";
import { invoiceState, INVOICE_TOKEN_RE, payOptions, reminderDue, type Deposit, type InvoiceState } from "@/lib/invoices";
import { baseVars, designedEmail } from "./email-designs";
import { locationOrDefault, paymentContextForSale } from "./locations";
import { platformFeeBpsFor } from "./price-book";
import { ensureStripeCustomer } from "./stripe-connect";
import { markCardPaymentSucceeded, recomputeSale, recordManualPayment, settleHelcimPayment, voidSale } from "./sales";
import { helcimTokenOf } from "./helcim/account";
import { helcim } from "./helcim/client";
import { getHelcimCheckout, HelcimCheckoutError, markHelcimCheckoutUsed, openHelcimCheckout, verifyHelcimCheckout } from "./helcim/online";
import { productLabel } from "@/lib/inventory";

export class InvoiceError extends Error {}

type Business = typeof schema.businesses.$inferSelect;
type Invoice = typeof schema.invoices.$inferSelect;
type Sale = typeof schema.sales.$inferSelect;

export type InvoiceLineInput =
  | { kind: "service"; serviceId: string; staffId: string | null; priceCents: number | null }
  | { kind: "product"; productId: string; quantity: number; staffId: string | null }
  | { kind: "custom"; name: string; unitCents: number; quantity: number; taxable: boolean; staffId: string | null };

export interface InvoiceInput {
  clientId: string;
  locationId: string | null;
  lines: InvoiceLineInput[];
  discount: Discount | null;
  taxExempt: boolean;
  dueOn: string | null;
  note: string | null;
  deposit: Deposit;
  remind: boolean;
}

/** The link's token: 32 random bytes, so it can't be guessed or counted through. */
export const newInvoiceToken = () => randomBytes(32).toString("base64url");

export const invoiceUrl = (business: Pick<Business, "slug" | "customDomain" | "customDomainStatus">, token: string) => siteUrl(business, `/invoice/${token}`);

const todayIn = (business: Pick<Business, "timezone">) => instantToISODate(new Date(), business.timezone);

/** The list's status filter, as SQL: the same rule as invoiceState (lib/invoices.ts). */
export function stateSql(today: string): SQL<InvoiceState> {
  const i = schema.invoices;
  const s = schema.sales;
  return sql<InvoiceState>`case
    when ${i.status} = 'void' or ${s.status} = 'void' then 'void'
    when ${s.status} in ('paid', 'refunded') then 'paid'
    when ${i.status} = 'sent' and ${i.dueOn} is not null and ${i.dueOn} < ${today} then 'overdue'
    when ${s.paidCents} > 0 then 'partly_paid'
    when ${i.status} = 'draft' then 'draft'
    when ${i.viewedAt} is not null then 'viewed'
    else 'sent' end`;
}

// ---------------------------------------------------------------------------
// The desk: create, edit, list, send, void, record a cash or check payment
// ---------------------------------------------------------------------------

/** Write the invoice's lines: the editor owns service, product and custom lines; anything added on the ticket (a tip, a gift card) stays. */
async function writeLines(tx: TenantDb, businessId: string, saleId: string, lines: InvoiceLineInput[]) {
  if (!lines.length) throw new InvoiceError("Add at least one line.");
  if (lines.length > 60) throw new InvoiceError("An invoice can have up to 60 lines.");
  await tx.delete(schema.saleLines).where(and(eq(schema.saleLines.saleId, saleId), inArray(schema.saleLines.kind, ["service", "product"]), eq(schema.saleLines.creditCents, 0)));
  const staffIds = new Set((await tx.select({ id: schema.staff.id }).from(schema.staff)).map((r) => r.id));
  const staffOf = (id: string | null) => (id && staffIds.has(id) ? id : null);
  const rows: (typeof schema.saleLines.$inferInsert)[] = [];
  for (const [i, l] of lines.entries()) {
    if (l.kind === "service") {
      const service = await tx.query.services.findFirst({ where: eq(schema.services.id, l.serviceId) });
      if (!service) throw new InvoiceError("One of the services no longer exists.");
      const override = l.staffId ? await tx.query.staffServices.findFirst({ where: and(eq(schema.staffServices.staffId, l.staffId), eq(schema.staffServices.serviceId, service.id)) }) : null;
      const price = l.priceCents ?? override?.priceCentsOverride ?? service.priceCents;
      if (price < 0) throw new InvoiceError("Prices can't be negative.");
      rows.push({ businessId, saleId, kind: "service", staffId: staffOf(l.staffId), serviceId: service.id, name: service.name, quantity: 1, unitCents: price, amountCents: price, taxable: false, sortOrder: i });
    } else if (l.kind === "product") {
      const p = await tx.query.products.findFirst({ where: eq(schema.products.id, l.productId) });
      if (!p || p.kind !== "retail") throw new InvoiceError("One of the products is no longer sold.");
      const qty = Math.max(1, Math.min(99, Math.round(l.quantity)));
      rows.push({ businessId, saleId, kind: "product", staffId: staffOf(l.staffId), productId: p.id, name: productLabel(p), quantity: qty, unitCents: p.priceCents, amountCents: p.priceCents * qty, taxable: p.taxable, sortOrder: i });
    } else {
      // A custom line is work (a bridal trial, travel to the venue): a service line with no service, credited to its stylist for commission.
      const name = l.name.trim().slice(0, 120);
      if (!name) throw new InvoiceError("Give each custom line a description.");
      if (!Number.isInteger(l.unitCents) || l.unitCents < 0) throw new InvoiceError(`Enter a price for ${name}.`);
      const qty = Math.max(1, Math.min(99, Math.round(l.quantity)));
      rows.push({ businessId, saleId, kind: "service", staffId: staffOf(l.staffId), name, quantity: qty, unitCents: l.unitCents, amountCents: l.unitCents * qty, taxable: l.taxable, sortOrder: i });
    }
  }
  await tx.insert(schema.saleLines).values(rows);
}

function checkInput(input: InvoiceInput) {
  if (input.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) throw new InvoiceError("Pick a due date.");
  if (input.deposit && (!Number.isInteger(input.deposit.value) || input.deposit.value <= 0 || (input.deposit.type === "percent" && input.deposit.value >= 100))) throw new InvoiceError(input.deposit.type === "percent" ? "A deposit is between 1% and 99%." : "Enter the deposit amount.");
  if (input.discount && input.discount.type === "percent" && (input.discount.value <= 0 || input.discount.value > 100)) throw new InvoiceError("A discount is between 1% and 100%.");
}

/** Save the sale's settings and lines, recompute, and refuse a total that is nothing or less than what was already paid. */
async function saveMoney(tx: TenantDb, business: Business, sale: Sale, input: InvoiceInput, actorUserId: string) {
  await tx.update(schema.sales).set({ clientId: input.clientId, taxExempt: input.taxExempt, discountType: input.discount?.type ?? null, discountValue: input.discount?.value ?? null, promoCodeId: null }).where(eq(schema.sales.id, sale.id));
  await writeLines(tx, business.id, sale.id, input.lines);
  const t = await recomputeSale(tx, business.id, sale.id, business.taxRateBps, actorUserId);
  if (t.totalCents < 100) throw new InvoiceError("An invoice total must be at least $1.00.");
  if (t.totalCents < t.paidCents) throw new InvoiceError(`The client has already paid ${formatMoney(t.paidCents, business.currency)}, so the total can't be less than that.`);
  if (input.deposit?.type === "amount" && input.deposit.value >= t.totalCents) throw new InvoiceError("The deposit must be less than the total.");
}

export async function createInvoice(business: Business, input: InvoiceInput, actorUserId: string): Promise<string> {
  checkInput(input);
  return withTenant(business.id, async (tx) => {
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, input.clientId), columns: { id: true } });
    if (!client) throw new InvoiceError("Choose a client.");
    const rows = await tx.execute<{ n: number }>(sql`select next_sale_number(${business.id}) as n`);
    const location = await locationOrDefault(tx, input.locationId);
    const [sale] = await tx
      .insert(schema.sales)
      .values({ businessId: business.id, number: Number(rows[0]?.n ?? 1001), clientId: client.id, locationId: location?.id ?? null, currency: business.currency, source: "invoice", createdByUserId: actorUserId })
      .returning();
    await saveMoney(tx, business, sale!, input, actorUserId);
    const [inv] = await tx
      .insert(schema.invoices)
      .values({ businessId: business.id, saleId: sale!.id, token: newInvoiceToken(), dueOn: input.dueOn, note: input.note, depositType: input.deposit?.type ?? null, depositValue: input.deposit?.value ?? null, remind: input.remind, createdByUserId: actorUserId })
      .returning({ id: schema.invoices.id });
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: "invoice.create", entity: "sale", entityId: sale!.id, diff: JSON.stringify({ invoiceId: inv!.id }) });
    return inv!.id;
  });
}

/** Change an unpaid invoice (draft or sent). A sent one keeps its link; the client sees the new version the next time they open it. */
export async function updateInvoice(business: Business, invoiceId: string, input: InvoiceInput, actorUserId: string) {
  checkInput(input);
  await withTenant(business.id, async (tx) => {
    const inv = await tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) });
    if (!inv) throw new InvoiceError("Invoice not found.");
    const [sale] = await tx.select().from(schema.sales).where(eq(schema.sales.id, inv.saleId)).for("update");
    if (!sale || inv.status === "void" || sale.status !== "open") throw new InvoiceError(sale?.status === "paid" ? "This invoice is paid and can't be changed." : "This invoice is void.");
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, input.clientId), columns: { id: true } });
    if (!client) throw new InvoiceError("Choose a client.");
    if (sale.paidCents > 0 && client.id !== sale.clientId) throw new InvoiceError("The client has already paid part of this invoice, so it stays theirs.");
    if (input.locationId && input.locationId !== sale.locationId && sale.paidCents === 0) {
      const location = await locationOrDefault(tx, input.locationId);
      await tx.update(schema.sales).set({ locationId: location?.id ?? null }).where(eq(schema.sales.id, sale.id));
    }
    await saveMoney(tx, business, sale, input, actorUserId);
    await tx.update(schema.invoices).set({ dueOn: input.dueOn, note: input.note, depositType: input.deposit?.type ?? null, depositValue: input.deposit?.value ?? null, remind: input.remind, ...(input.dueOn !== inv.dueOn ? { remindersSent: [] } : {}) }).where(eq(schema.invoices.id, inv.id));
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: "invoice.edit", entity: "sale", entityId: sale.id, diff: JSON.stringify({ invoiceId: inv.id }) });
  });
}

export async function getInvoice(businessId: string, invoiceId: string) {
  return withTenant(businessId, async (tx) => {
    const inv = await tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) });
    if (!inv) return null;
    return loadInvoice(tx, inv);
  });
}

async function loadInvoice(tx: TenantDb, inv: Invoice) {
  const sale = (await tx.query.sales.findFirst({ where: eq(schema.sales.id, inv.saleId) }))!;
  const [lines, payments, client] = await Promise.all([
    tx.select().from(schema.saleLines).where(eq(schema.saleLines.saleId, sale.id)).orderBy(asc(schema.saleLines.sortOrder), asc(schema.saleLines.id)),
    tx.select().from(schema.payments).where(eq(schema.payments.saleId, sale.id)).orderBy(asc(schema.payments.createdAt)),
    sale.clientId ? tx.query.clients.findFirst({ where: eq(schema.clients.id, sale.clientId) }) : Promise.resolve(undefined),
  ]);
  return { invoice: inv, sale, lines, payments, client: client ?? null };
}

export type InvoiceListFilter = { state?: InvoiceState | "unpaid" | null; q?: string | null; page?: number };

/** Invoices for Sales → Invoices: newest first, filtered by status (worked out in SQL from the sale and dates) and client or number. */
export async function listInvoices(business: Business, f: InvoiceListFilter) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = 50;
  const today = todayIn(business);
  const state = stateSql(today);
  return withTenant(business.id, async (tx) => {
    const conds: SQL[] = [];
    if (f.state === "unpaid") conds.push(sql`${state} in ('sent', 'viewed', 'partly_paid', 'overdue')`);
    else if (f.state) conds.push(sql`${state} = ${f.state}`);
    const q = f.q?.trim();
    if (q) {
      const n = Number(q.replace(/^#/, ""));
      const like = `%${q}%`;
      conds.push(Number.isInteger(n) ? sql`(${schema.sales.number} = ${n} or ${schema.clients.firstName} ilike ${like} or ${schema.clients.lastName} ilike ${like})` : sql`(${schema.clients.firstName} ilike ${like} or ${schema.clients.lastName} ilike ${like} or (${schema.clients.firstName} || ' ' || ${schema.clients.lastName}) ilike ${like})`);
    }
    const where = conds.length ? and(...conds) : undefined;
    const [rows, count, totals] = await Promise.all([
      tx
        .select({ invoice: schema.invoices, sale: schema.sales, clientFirst: schema.clients.firstName, clientLast: schema.clients.lastName, state })
        .from(schema.invoices)
        .innerJoin(schema.sales, eq(schema.sales.id, schema.invoices.saleId))
        .leftJoin(schema.clients, eq(schema.clients.id, schema.sales.clientId))
        .where(where)
        .orderBy(desc(schema.invoices.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      tx.select({ n: sql<number>`count(*)::int` }).from(schema.invoices).innerJoin(schema.sales, eq(schema.sales.id, schema.invoices.saleId)).leftJoin(schema.clients, eq(schema.clients.id, schema.sales.clientId)).where(where).then((r) => Number(r[0]?.n ?? 0)),
      // What is owed across every unpaid invoice, and how much of it is overdue (the header's two numbers).
      tx
        .select({ owed: sql<number>`coalesce(sum(${schema.sales.totalCents} - ${schema.sales.paidCents}) filter (where ${state} in ('sent','viewed','partly_paid','overdue')), 0)::int`, overdue: sql<number>`coalesce(sum(${schema.sales.totalCents} - ${schema.sales.paidCents}) filter (where ${state} = 'overdue'), 0)::int` })
        .from(schema.invoices)
        .innerJoin(schema.sales, eq(schema.sales.id, schema.invoices.saleId)),
    ]);
    return { rows, total: count, page, pageSize, owedCents: Number(totals[0]?.owed ?? 0), overdueCents: Number(totals[0]?.overdue ?? 0) };
  });
}

const brandFor = async (business: Business, saleId: string): Promise<BrandCtx> => {
  const pay = await paymentContextForSale(business, saleId);
  return { businessName: pay.name, logoUrl: business.logoUrl, brandColor: business.brandColor, businessPhone: pay.phone, address: pay.addressLine };
};

const dueDateLabel = (dueOn: string | null) => (dueOn ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${dueOn}T12:00:00Z`)) : null);

/** The email (and text) that carries the invoice: the first send, a resend, or a reminder. */
async function composeInvoice(business: Business, data: NonNullable<Awaited<ReturnType<typeof getInvoice>>>, reminder: "before" | "due" | "after" | null) {
  const { invoice, sale, lines, client } = data;
  const m = (c: number) => formatMoney(c, business.currency);
  const brand = await brandFor(business, sale.id);
  const opts = payOptions(invoice.depositType ? { type: invoice.depositType, value: invoice.depositValue ?? 0 } : null, sale);
  const url = invoiceUrl(business, invoice.token);
  const due = dueDateLabel(invoice.dueOn);
  const t = invoiceEmail(brand, {
    number: sale.number,
    lines: lines.filter((l) => l.kind !== "tip").map((l) => ({ name: l.name, quantity: l.quantity, amount: m(l.amountCents) })),
    subtotal: m(sale.subtotalCents),
    discount: sale.discountCents ? m(sale.discountCents) : null,
    tax: sale.taxCents ? m(sale.taxCents) : null,
    total: m(sale.totalCents),
    paid: sale.paidCents ? m(sale.paidCents) : null,
    balance: m(opts.balanceCents),
    dueNow: opts.depositDueCents ? m(opts.depositDueCents) : null,
    dueDate: due,
    note: invoice.note,
    payUrl: url,
    reminder,
  });
  const mail = await withTenant(business.id, (tx) => designedEmail(tx, "invoice", t, brand, baseVars(business, brand, client)));
  const owed = opts.depositDueCents ? `${m(opts.depositDueCents)} deposit due now` : `${m(opts.balanceCents)} due${due ? ` ${reminder === "after" ? "since" : "by"} ${due}` : ""}`;
  const sms = `${brand.businessName}: ${reminder === "after" ? "past due, " : reminder ? "reminder, " : ""}invoice #${sale.number}, ${owed}. Pay online: ${url}`;
  return { mail, sms };
}

/** Email and/or text the invoice. The first send turns a draft into "sent"; later ones resend the same link. */
export async function sendInvoice(business: Business, invoiceId: string, to: { email: string | null; phone: string | null }, actorUserId: string) {
  const email = to.email?.trim() || null;
  const phone = to.phone ? normalizePhone(to.phone) : null;
  if (!email && !phone) throw new InvoiceError("Enter an email or a mobile number to send the invoice to.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InvoiceError("Enter a valid email address.");
  if (to.phone?.trim() && !phone) throw new InvoiceError("Enter a valid mobile number.");
  const data = await getInvoice(business.id, invoiceId);
  if (!data) throw new InvoiceError("Invoice not found.");
  if (data.invoice.status === "void" || data.sale.status === "void") throw new InvoiceError("This invoice is void.");
  if (data.sale.status !== "open") throw new InvoiceError("This invoice is already paid.");
  await withTenant(business.id, async (tx) => {
    await tx.update(schema.invoices).set({ status: "sent", sentAt: data.invoice.sentAt ?? new Date(), sentToEmail: email ?? data.invoice.sentToEmail, sentToPhone: phone ?? data.invoice.sentToPhone }).where(eq(schema.invoices.id, invoiceId));
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: data.invoice.status === "draft" ? "invoice.send" : "invoice.resend", entity: "sale", entityId: data.sale.id, diff: JSON.stringify({ email, phone }) });
  });
  const { mail, sms } = await composeInvoice(business, data, null);
  if (email) await queueOneOff(business.id, { channel: "email", template: "invoice", recipient: email, subject: mail.subject, body: mail.html, clientId: data.sale.clientId, locationId: data.sale.locationId });
  if (phone) await queueOneOff(business.id, { channel: "sms", template: "invoice", recipient: phone, body: sms, clientId: data.sale.clientId, locationId: data.sale.locationId });
}

/** Void an unpaid invoice: its sale is voided too, and the link says so. Money already taken must be refunded first (on the ticket). */
export async function voidInvoice(business: Business, invoiceId: string, actorUserId: string) {
  const data = await getInvoice(business.id, invoiceId);
  if (!data) throw new InvoiceError("Invoice not found.");
  if (data.invoice.status === "void") return;
  if (data.sale.status === "paid" || data.sale.status === "refunded") throw new InvoiceError("A paid invoice can't be voided. Refund it from its sale instead.");
  if (data.sale.paidCents > 0) throw new InvoiceError("The client has paid part of this invoice. Refund that payment on the sale first, then void it.");
  if (data.sale.status === "open") await voidSale({ businessId: business.id, saleId: data.sale.id, actorUserId });
  await withTenant(business.id, (tx) => tx.update(schema.invoices).set({ status: "void", voidedAt: new Date() }).where(eq(schema.invoices.id, invoiceId)));
}

/** Cash or a check handed over at the desk (or mailed): an ordinary payment on the sale. The client gets a receipt when they have an email. */
export async function recordInvoicePayment(business: Business, invoiceId: string, input: { method: "cash" | "check"; amountCents: number; checkNumber: string | null }, actorUserId: string) {
  const data = await getInvoice(business.id, invoiceId);
  if (!data) throw new InvoiceError("Invoice not found.");
  if (data.invoice.status === "void" || data.sale.status !== "open") throw new InvoiceError(data.sale.status === "paid" ? "This invoice is already paid." : "This invoice is void.");
  await recordManualPayment({
    businessId: business.id,
    saleId: data.sale.id,
    method: input.method === "cash" ? "cash" : "other",
    amountCents: input.amountCents,
    note: input.method === "check" ? `Check${input.checkNumber ? ` #${input.checkNumber}` : ""}` : null,
    actorUserId,
    taxRateBps: business.taxRateBps,
  });
  await afterInvoicePayment(business, data.sale.id, { notifyBusiness: false });
}

// ---------------------------------------------------------------------------
// The client's page: open by token, pay by card
// ---------------------------------------------------------------------------

/**
 * The invoice behind a link, or null. The token is the only key: a draft (not sent yet) is never shown, and the lookup is inside the
 * business's tenant, so a token from one salon opens nothing under another's address.
 */
export async function invoiceByToken(business: Business, token: string) {
  if (!INVOICE_TOKEN_RE.test(token)) return null;
  return withTenant(business.id, async (tx) => {
    const inv = await tx.query.invoices.findFirst({ where: eq(schema.invoices.token, token) });
    if (!inv || inv.status === "draft") return null;
    return loadInvoice(tx, inv);
  });
}

/** The client opened the link: "viewed" from now on (the first time only). */
export async function markInvoiceViewed(businessId: string, invoiceId: string) {
  await withTenant(businessId, (tx) => tx.update(schema.invoices).set({ viewedAt: new Date() }).where(and(eq(schema.invoices.id, invoiceId), sql`${schema.invoices.viewedAt} is null`)));
}

export function publicState(business: Business, data: NonNullable<Awaited<ReturnType<typeof invoiceByToken>>>): InvoiceState {
  return invoiceState(data.invoice, data.sale, todayIn(business));
}

export type StartPaymentResult =
  | { provider: "stripe"; clientSecret: string; intentId: string; accountId: string | null; publishableKey: string | null; amountCents: number }
  | { provider: "helcim"; checkoutToken: string; intentId: string; amountCents: number };

/**
 * Start a card payment of `amountCents` toward the invoice (at least the rest of any deposit, at most the balance). A pending payment row
 * is saved first, then the processor is called with no transaction open. An earlier attempt the client walked away from is dropped.
 */
export async function startInvoicePayment(business: Business, token: string, amountCents: number): Promise<StartPaymentResult> {
  const data = await invoiceByToken(business, token);
  if (!data || data.invoice.status === "void" || data.sale.status === "void") throw new InvoiceError("This invoice is no longer open.");
  if (data.sale.status !== "open") throw new InvoiceError("This invoice is already paid. Thank you!");
  const pay = await paymentContextForSale(business, data.sale.id);
  const onHelcim = pay.provider === "helcim";
  if (onHelcim ? !pay.helcimReady : !(pay.ready && pay.accountId && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)) throw new InvoiceError("Online payments aren't set up. Please contact the salon to pay.");
  await dropAbandonedAttempts(business, data.sale.id);
  const deposit: Deposit = data.invoice.depositType ? { type: data.invoice.depositType, value: data.invoice.depositValue ?? 0 } : null;
  const { pending, client, fee } = await withTenant(business.id, async (tx) => {
    const [sale] = await tx.select().from(schema.sales).where(eq(schema.sales.id, data.sale.id)).for("update");
    if (!sale || sale.status !== "open") throw new InvoiceError("This invoice is already paid. Thank you!");
    const opts = payOptions(deposit, sale);
    if (!Number.isInteger(amountCents) || amountCents < Math.max(50, opts.minCents) || amountCents > opts.balanceCents) {
      throw new InvoiceError(opts.depositDueCents ? `Pay at least the ${formatMoney(opts.depositDueCents, business.currency)} deposit, up to the ${formatMoney(opts.balanceCents, business.currency)} balance.` : `Enter an amount from ${formatMoney(Math.max(50, opts.minCents), business.currency)} to ${formatMoney(opts.balanceCents, business.currency)}.`);
    }
    const client = sale.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, sale.clientId) }) : undefined;
    const [pending] = await tx.insert(schema.payments).values({ businessId: business.id, saleId: sale.id, method: "card", status: "pending", amountCents, tipCents: 0, ...(onHelcim ? { provider: "helcim" as const } : { stripeAccountId: pay.accountId }) }).returning();
    const fee = Math.round((amountCents * (await platformFeeBpsFor(business.id, tx))) / 10_000);
    return { pending: pending!, client, fee };
  });
  if (onHelcim) {
    try {
      const c = await openHelcimCheckout(business, { purpose: "invoice", meta: { saleId: data.sale.id, paymentId: pending.id, invoiceId: data.invoice.id }, amountCents, client: client ?? null });
      await withTenant(business.id, (tx) => tx.update(schema.payments).set({ providerInvoice: c.id }).where(eq(schema.payments.id, pending.id)));
      return { provider: "helcim", checkoutToken: c.checkoutToken, intentId: c.id, amountCents };
    } catch (e) {
      await withTenant(business.id, (tx) => tx.delete(schema.payments).where(and(eq(schema.payments.id, pending.id), eq(schema.payments.status, "pending"))));
      throw new InvoiceError(e instanceof HelcimCheckoutError ? e.message : "Online payments are unavailable right now. Please try again.");
    }
  }
  const accountId = pay.accountId!;
  try {
    const customer = client ? await ensureStripeCustomer({ accountId, businessId: business.id, client }) : undefined;
    const pi = await stripe().paymentIntents.create(
      { amount: amountCents, currency: business.currency, customer, allowed_payment_method_types: ["card"], description: `Invoice #${data.sale.number} · ${pay.name}`, ...(client?.email ? { receipt_email: client.email } : {}), metadata: { businessId: business.id, saleId: data.sale.id, paymentId: pending.id, invoiceId: data.invoice.id, kind: "invoice" }, ...(fee > 0 ? { application_fee_amount: fee } : {}) },
      { stripeAccount: accountId, idempotencyKey: `invoice_${pending.id}` },
    );
    await withTenant(business.id, (tx) => tx.update(schema.payments).set({ stripePaymentIntentId: pi.id }).where(eq(schema.payments.id, pending.id)));
    const browser = await browserStripe(accountId, process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
    return { provider: "stripe", clientSecret: pi.client_secret!, intentId: pi.id, accountId: browser.stripeAccount, publishableKey: browser.publishableKey, amountCents };
  } catch (e) {
    await withTenant(business.id, (tx) => tx.delete(schema.payments).where(and(eq(schema.payments.id, pending.id), eq(schema.payments.status, "pending"), sql`${schema.payments.stripePaymentIntentId} is null`)));
    throw e;
  }
}

/** Earlier online attempts on this invoice that were never paid: canceled and dropped, so they don't sit as "Pending". One that may have just been paid stays for the webhook. */
async function dropAbandonedAttempts(business: Business, saleId: string) {
  const old = await withTenant(business.id, (tx) => tx.select().from(schema.payments).where(and(eq(schema.payments.saleId, saleId), eq(schema.payments.status, "pending"), eq(schema.payments.method, "card"), sql`${schema.payments.createdByUserId} is null`)));
  for (const p of old) {
    if (p.provider === "helcim") {
      const c = p.providerInvoice ? await getHelcimCheckout(business.id, p.providerInvoice) : null;
      if (c && c.status !== "open" && c.status !== "void") continue; // Paid: the sweep records it.
      if (c) await withTenant(business.id, (tx) => tx.update(schema.helcimCheckouts).set({ status: "void" }).where(and(eq(schema.helcimCheckouts.id, c.id), eq(schema.helcimCheckouts.status, "open"))));
    } else if (p.stripePaymentIntentId) {
      const acct = p.stripeAccountId!;
      const gone = await stripe().paymentIntents.cancel(p.stripePaymentIntentId, {}, { stripeAccount: acct }).then(
        () => true,
        async () => stripe().paymentIntents.retrieve(p.stripePaymentIntentId!, {}, { stripeAccount: acct }).then((x) => x.status === "canceled", () => false),
      );
      if (!gone) continue;
    }
    await withTenant(business.id, (tx) => tx.delete(schema.payments).where(and(eq(schema.payments.id, p.id), eq(schema.payments.status, "pending"))));
  }
}

/**
 * The client's card went through on the page: confirm it with the processor and record it on the sale (closing it when that pays it
 * off), then send the receipts. Safe to run twice, and alongside the webhook or the sweep.
 */
export async function finishInvoicePayment(business: Business, token: string, intentId: string, helcimEvent?: unknown) {
  const data = await invoiceByToken(business, token);
  if (!data) throw new InvoiceError("Invoice not found.");
  const pay = await paymentContextForSale(business, data.sale.id);
  if (pay.provider === "helcim") {
    let row;
    try {
      row = await verifyHelcimCheckout(business, intentId, helcimEvent);
    } catch (e) {
      if (e instanceof HelcimCheckoutError) throw new InvoiceError(e.message);
      throw e;
    }
    if (row.purpose !== "invoice" || row.meta.saleId !== data.sale.id) throw new InvoiceError("That payment doesn't match this invoice.");
    await settleHelcimInvoiceCheckout(business, row.id);
  } else {
    if (!pay.accountId) throw new InvoiceError("Payments aren't set up.");
    const pi = await stripe().paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }, { stripeAccount: pay.accountId });
    if (pi.metadata?.saleId !== data.sale.id || pi.metadata?.businessId !== business.id) throw new InvoiceError("That payment doesn't match this invoice.");
    if (pi.status !== "succeeded") throw new InvoiceError(pi.status === "processing" ? "Your payment is processing. This page will update once it clears." : `Payment ${pi.status.replace(/_/g, " ")}.`);
    const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
    await markCardPaymentSucceeded({ businessId: business.id, paymentIntentId: pi.id, chargeId: charge?.id ?? (typeof pi.latest_charge === "string" ? pi.latest_charge : null), card: { brand: charge?.payment_method_details?.card?.brand ?? null, last4: charge?.payment_method_details?.card?.last4 ?? null }, taxRateBps: business.taxRateBps, metadata: pi.metadata });
  }
  await afterInvoicePayment(business, data.sale.id, { notifyBusiness: true });
}

/** Record a verified (paid) Helcim invoice checkout on its pending payment, once: the checkout turns "used". */
async function settleHelcimInvoiceCheckout(business: Business, checkoutId: string) {
  const row = await getHelcimCheckout(business.id, checkoutId);
  const token = helcimTokenOf(business);
  if (!row || row.status === "used") return;
  if (row.status !== "paid" || !row.transactionId || !token) throw new InvoiceError("That payment wasn't confirmed.");
  const t = await helcim.getTransaction(token, row.transactionId);
  await settleHelcimPayment({ businessId: business.id, paymentId: row.meta.paymentId!, transaction: t, taxRateBps: business.taxRateBps, expectedAmountCents: row.amountCents });
  await markHelcimCheckoutUsed(business.id, row.id);
}

/**
 * After money landed on an invoice's sale: stamp it paid when the sale closed, and send each new payment's receipt once (the full receipt
 * when it is paid off, else "payment received, balance left"), with a note to the business for payments made online.
 */
export async function afterInvoicePayment(business: Business, saleId: string, opts: { notifyBusiness: boolean }) {
  const data = await withTenant(business.id, async (tx) => {
    const inv = await tx.query.invoices.findFirst({ where: eq(schema.invoices.saleId, saleId) });
    if (!inv) return null;
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, saleId) });
    if (sale?.status === "paid" && !inv.paidAt) await tx.update(schema.invoices).set({ paidAt: sale.closedAt ?? new Date() }).where(eq(schema.invoices.id, inv.id));
    return loadInvoice(tx, inv);
  });
  if (!data) return;
  const done = data.payments.filter((p) => p.status === "succeeded" && !data.invoice.receiptedPaymentIds.includes(p.id));
  for (const p of done) {
    // Claim the receipt first, so the page and the webhook never both send it.
    const claimed = await withTenant(business.id, (tx) =>
      tx.update(schema.invoices).set({ receiptedPaymentIds: sql`array_append(${schema.invoices.receiptedPaymentIds}, ${p.id})` }).where(and(eq(schema.invoices.id, data.invoice.id), sql`not (${p.id} = any(${schema.invoices.receiptedPaymentIds}))`)).returning({ id: schema.invoices.id }),
    );
    if (!claimed.length) continue;
    await sendPaymentReceipt(business, data, p).catch((e) => console.error("[invoices] receipt failed", saleId, (e as Error).message));
    if (opts.notifyBusiness && p.createdByUserId == null && business.email) {
      const m = (c: number) => formatMoney(c, business.currency);
      const name = data.client ? `${data.client.firstName} ${data.client.lastName ?? ""}`.trim() : "A client";
      const left = data.sale.totalCents - data.sale.paidCents;
      const brand = await brandFor(business, saleId);
      const t = transactionalEmail(brand, { subject: `${name} paid ${m(p.amountCents)} on invoice #${data.sale.number}`, text: `${name} paid ${m(p.amountCents)} online toward invoice #${data.sale.number}.\n\n${left > 0 ? `Balance left: ${m(left)}.` : "The invoice is paid in full."}`, ctaLabel: "Open the invoice", ctaUrl: siteAppUrl(business, data.invoice.id) });
      await queueOneOff(business.id, { channel: "email", template: "staff_invoice_paid", recipient: business.email, subject: t.subject, body: t.html }).catch(() => undefined);
    }
  }
}

const siteAppUrl = (business: Business, invoiceId: string) => appUrl(`/app/${business.slug}/sales/invoices/${invoiceId}`);

async function sendPaymentReceipt(business: Business, data: Awaited<ReturnType<typeof loadInvoice>>, p: typeof schema.payments.$inferSelect) {
  const to = data.invoice.sentToEmail ?? data.client?.email ?? null;
  if (!to) return;
  const { sale, lines, payments, client } = data;
  const brand = await brandFor(business, sale.id);
  const pay = await paymentContextForSale(business, sale.id);
  const m = (c: number) => formatMoney(c, business.currency);
  const label = (x: typeof p) => `${paymentMethodLabel(x.method)}${x.cardLast4 ? ` ****${x.cardLast4}` : x.note ? ` (${x.note})` : ""}`;
  if (sale.status === "paid") {
    const t = receiptEmail({
      ...brand,
      number: sale.number,
      when: new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone }).format(sale.closedAt ?? new Date()),
      clientName: client ? `${client.firstName} ${client.lastName ?? ""}`.trim() : null,
      lines: lines.filter((l) => l.kind !== "tip").map((l) => ({ name: l.name, quantity: l.quantity, amount: m(l.amountCents) })),
      subtotal: m(sale.subtotalCents),
      discount: sale.discountCents ? m(sale.discountCents) : null,
      tax: sale.taxCents ? m(sale.taxCents) : null,
      taxRate: sale.taxCents ? `${(pay.taxRateBps / 100).toFixed(2).replace(/\.?0+$/, "")}%` : null,
      tip: sale.tipCents ? m(sale.tipCents) : null,
      total: m(sale.totalCents),
      payments: payments.filter((x) => x.status !== "failed" && x.status !== "pending").map((x) => ({ label: label(x), amount: m(x.amountCents) })),
      refunded: sale.refundedCents ? m(sale.refundedCents) : null,
      footer: business.receiptFooter,
    });
    const mail = await withTenant(business.id, (tx) => designedEmail(tx, "receipt", t, brand, baseVars(business, brand, client)));
    await queueOneOff(business.id, { channel: "email", template: "receipt", recipient: to, subject: mail.subject, body: mail.html, clientId: sale.clientId, locationId: sale.locationId });
    return;
  }
  const t = invoicePaymentEmail(brand, { number: sale.number, amount: m(p.amountCents), method: label(p), balance: m(sale.totalCents - sale.paidCents), payUrl: invoiceUrl(business, data.invoice.token) });
  await queueOneOff(business.id, { channel: "email", template: "invoice_payment", recipient: to, subject: t.subject, body: t.html, clientId: sale.clientId, locationId: sale.locationId });
}

// ---------------------------------------------------------------------------
// The jobs run: reminders, and Helcim payments whose page closed before it came back
// ---------------------------------------------------------------------------

/**
 * Remind clients of unpaid invoices that were sent with reminders on: three days before the due date, on it, a day after and a week
 * after, each once, by the channels the invoice went out on, from 9am in the business's time zone. Called by the 5-minute jobs run.
 */
export async function sendInvoiceReminders(opts: { now?: Date; businessIds?: string[] } = {}): Promise<{ checked: number; sent: number; failed: number }> {
  const now = opts.now ?? new Date();
  const out = { checked: 0, sent: 0, failed: 0 };
  const due = await withJobs((tx) =>
    tx
      .select({ id: schema.invoices.id, businessId: schema.invoices.businessId })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.status, "sent"), eq(schema.invoices.remind, true), isNotNull(schema.invoices.dueOn), lt(schema.invoices.dueOn, shiftISODate(instantToISODate(now, "UTC"), 4)), opts.businessIds ? inArray(schema.invoices.businessId, opts.businessIds) : sql`true`))
      .limit(500),
  );
  const businesses = new Map<string, Business | undefined>();
  for (const r of due) {
    if (!businesses.has(r.businessId)) businesses.set(r.businessId, await db.query.businesses.findFirst({ where: eq(schema.businesses.id, r.businessId) }));
    const business = businesses.get(r.businessId);
    if (!business || business.suspendedAt) continue;
    const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: business.timezone }).format(now));
    if (hour < 9 || hour >= 20) continue;
    out.checked++;
    try {
      const data = await getInvoice(business.id, r.id);
      if (!data || data.sale.status !== "open" || !data.invoice.dueOn || !data.invoice.sentAt) continue;
      const today = instantToISODate(now, business.timezone);
      const step = reminderDue(data.invoice.dueOn, today, instantToISODate(data.invoice.sentAt, business.timezone), data.invoice.remindersSent, shiftISODate);
      if (!step) continue;
      // Claim the step first, so two runs at once send it once.
      const claimed = await withTenant(business.id, (tx) =>
        tx.update(schema.invoices).set({ remindersSent: sql`${schema.invoices.remindersSent} || string_to_array(${[step.key, ...step.markAlso].join(",")}, ',')` }).where(and(eq(schema.invoices.id, r.id), sql`not (${step.key} = any(${schema.invoices.remindersSent}))`)).returning({ id: schema.invoices.id }),
      );
      if (!claimed.length) continue;
      const { mail, sms } = await composeInvoice(business, data, step.key === "before" ? "before" : step.key === "due" ? "due" : "after");
      if (data.invoice.sentToEmail) await queueOneOff(business.id, { channel: "email", template: "invoice_reminder", recipient: data.invoice.sentToEmail, subject: mail.subject, body: mail.html, clientId: data.sale.clientId, locationId: data.sale.locationId });
      if (data.invoice.sentToPhone) await queueOneOff(business.id, { channel: "sms", template: "invoice_reminder", recipient: data.invoice.sentToPhone, body: sms, clientId: data.sale.clientId, locationId: data.sale.locationId });
      out.sent++;
    } catch (e) {
      out.failed++;
      console.error("[invoices] reminder failed", r.id, (e as Error).message);
    }
  }
  return out;
}

/** Helcim invoice payments that went through but whose page never came back (signal lost, tab closed): recorded after five minutes, never refunded. */
export async function sweepHelcimInvoicePayments(): Promise<{ checked: number; settled: number; failed: number }> {
  const rows = await withJobs((tx) => tx.select().from(schema.helcimCheckouts).where(and(eq(schema.helcimCheckouts.status, "paid"), eq(schema.helcimCheckouts.purpose, "invoice"), lt(schema.helcimCheckouts.paidAt, sql`now() - interval '5 minutes'`))).limit(100));
  const out = { checked: rows.length, settled: 0, failed: 0 };
  for (const row of rows) {
    const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, row.businessId) });
    if (!business) continue;
    try {
      await settleHelcimInvoiceCheckout(business, row.id);
      if (row.meta.saleId) await afterInvoicePayment(business, row.meta.saleId, { notifyBusiness: true });
      out.settled++;
    } catch (e) {
      out.failed++;
      console.error("[invoices] settling Helcim payment failed", row.id, (e as Error).message);
    }
  }
  return out;
}

/** Stripe's webhook: an invoice's PaymentIntent succeeded (the sale is already updated by markCardPaymentSucceeded); send its receipts. */
export async function invoicePaidByWebhook(business: Business, saleId: string) {
  await afterInvoicePayment(business, saleId, { notifyBusiness: true });
}

