/**
 * Email designs on the server: saved designs (campaigns and workflow emails pick them), custom designs of the automatic emails, the
 * merge-field values each email fills in, and the sample content the designer previews and test-sends.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { normalizeBlocks, renderEmail, SAMPLE_VARS, type EmailBrand, type EmailDesign, type MergeVars } from "@/lib/email-design";
import { postalAddress } from "@/server/locations";
import type { SystemEmailKey } from "@/lib/email-design/system";
import { giftCardEmail, orderEmail, receiptEmail, reviewRequestTemplate, templates, type ApptContext, type BrandCtx } from "@/lib/notify/templates";
import { appUrl } from "@/lib/stripe";
import { siteUrl } from "@/lib/site-url";
import { formatTime } from "@/lib/utils";

type Business = typeof schema.businesses.$inferSelect;
type Row = typeof schema.emailTemplates.$inferSelect;

export const designOf = (r: Pick<Row, "kind" | "subject" | "preheader" | "blocks">): EmailDesign => ({ subject: r.subject, preheader: r.preheader, blocks: normalizeBlocks(r.blocks, { core: r.kind === "system" }) });

export const brandOf = (ctx: BrandCtx): EmailBrand => ({ name: ctx.businessName, logoUrl: ctx.logoUrl, color: ctx.brandColor, phone: ctx.businessPhone, address: ctx.address });

/** The Angelic Booking mark in the "Sent by" line. */
export const markUrl = () => appUrl("/brand/mark-192.png");

/** Fields every email can fill: the client, the business and its booking page. */
export function baseVars(business: Pick<Business, "slug" | "customDomain" | "customDomainStatus">, ctx: BrandCtx, client?: { firstName?: string | null; lastName?: string | null } | null): MergeVars {
  return { first_name: client?.firstName || "there", last_name: client?.lastName ?? "", business: ctx.businessName, business_phone: ctx.businessPhone ?? "", business_address: ctx.address ?? "", booking_url: siteUrl(business) };
}

/** Fields of an appointment email (the same values the text wording uses). */
export function apptVars(business: Pick<Business, "slug" | "customDomain" | "customDomainStatus">, ctx: ApptContext, extra: { review_url?: string; last_name?: string | null } = {}): MergeVars {
  const date = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: ctx.timeZone }).format(ctx.startAt);
  const time = formatTime(ctx.startAt, ctx.timeZone);
  return {
    ...baseVars(business, ctx, { firstName: ctx.clientFirstName, lastName: extra.last_name }),
    service: ctx.services,
    staff: ctx.staffName,
    date,
    time,
    when: `${date} at ${time}`,
    manage_url: ctx.manageUrl,
    forms_url: ctx.formsUrl ?? "",
    deposit: ctx.depositPaid ?? "",
    review_url: extra.review_url ?? "",
  };
}

/** The automatic email `key` in the business's own design, or the default look when it has none. Runs inside the tenant tx. */
export async function designedEmail(tx: TenantDb, key: SystemEmailKey, fallback: { subject: string; content: string; html: string }, ctx: BrandCtx, vars: MergeVars): Promise<{ subject: string; html: string }> {
  const row = await tx.query.emailTemplates.findFirst({ where: and(eq(schema.emailTemplates.kind, "system"), eq(schema.emailTemplates.key, key)) });
  if (!row) return { subject: fallback.subject, html: fallback.html };
  const design = designOf(row);
  const r = renderEmail(design, { brand: brandOf(ctx), vars, core: fallback.content, markUrl: markUrl() });
  return { subject: design.subject.trim() ? r.subject : fallback.subject, html: r.html };
}

/** A saved design (campaigns, workflow emails), or null when it was deleted. */
export async function savedDesign(tx: TenantDb, id: string | null | undefined): Promise<EmailDesign | null> {
  if (!id) return null;
  const row = await tx.query.emailTemplates.findFirst({ where: and(eq(schema.emailTemplates.id, id), eq(schema.emailTemplates.kind, "saved")) });
  return row ? designOf(row) : null;
}

export async function listSavedDesigns(businessId: string) {
  return withTenant(businessId, (tx) =>
    tx.select({ id: schema.emailTemplates.id, name: schema.emailTemplates.name, subject: schema.emailTemplates.subject, updatedAt: schema.emailTemplates.updatedAt }).from(schema.emailTemplates).where(eq(schema.emailTemplates.kind, "saved")).orderBy(desc(schema.emailTemplates.updatedAt)),
  );
}

export async function listSystemDesigns(businessId: string) {
  return withTenant(businessId, (tx) => tx.select({ key: schema.emailTemplates.key, updatedAt: schema.emailTemplates.updatedAt }).from(schema.emailTemplates).where(eq(schema.emailTemplates.kind, "system")).orderBy(asc(schema.emailTemplates.key)));
}

/** The brand an email from this business carries, using its main address. */
export function businessBrand(business: Business, address?: string | null): BrandCtx {
  return { businessName: business.name, logoUrl: business.logoUrl, brandColor: business.brandColor, businessPhone: business.phone, address: address ?? business.addressLine };
}

/** A made-up visit for previews and test emails, in the business's own name, colors and clock. */
export function sampleAppt(business: Business, brand: BrandCtx): ApptContext {
  const start = new Date(Date.now() + 3 * 86_400_000);
  start.setUTCHours(18, 30, 0, 0);
  return {
    ...brand,
    timeZone: business.timezone,
    clientFirstName: "Maria",
    services: "Classic Lash Full Set",
    staffName: "Ava",
    startAt: start,
    manageUrl: siteUrl(business, "/manage/sample"),
    policy: business.bookingPolicy,
    cancelWindowHours: business.cancelWindowHours,
    lateCancelFee: null,
    depositPaid: null,
    cardOnFile: false,
    formsUrl: null,
    prepNotes: [],
  };
}

/** What an automatic email's "Message details" block holds, filled with the sample visit: shown in the preview and the test email. */
export function sampleSystemEmail(business: Business, key: SystemEmailKey, brand: BrandCtx): { subject: string; content: string; html: string; vars: MergeVars } {
  const ctx = sampleAppt(business, brand);
  const vars = { ...apptVars(business, ctx, { review_url: siteUrl(business, "/review/sample"), last_name: "Lopez" }) };
  const money = (n: number) => `$${n.toFixed(2)}`;
  switch (key) {
    case "confirmation": return { ...templates.confirmation(ctx), vars };
    case "reminder": return { ...templates.reminder(ctx), vars };
    case "rescheduled": return { ...templates.rescheduled(ctx), vars };
    case "cancellation": return { ...templates.cancellation(ctx), vars };
    case "forms_nudge": return { ...templates.formsNudge({ ...ctx, formsUrl: siteUrl(business, "/manage/sample/forms") }), vars };
    case "review_request": return { ...reviewRequestTemplate(ctx, String(vars.review_url)), vars };
    case "receipt":
      return { ...receiptEmail({ ...brand, number: 1042, when: new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone }).format(new Date()), clientName: "Maria Lopez", lines: [{ name: "Classic Lash Full Set", quantity: 1, amount: money(150) }, { name: "Lash cleanser", quantity: 1, amount: money(18) }], subtotal: money(168), discount: null, tax: money(1.08), taxRate: "6%", tip: money(30), total: money(199.08), payments: [{ label: "Visa •••• 4242", amount: money(199.08) }], refunded: null, footer: business.receiptFooter }), vars };
    case "gift_card": return { ...giftCardEmail(brand, { code: "GIFT-7K2P-M9QD", amount: money(100), from: "Jess", message: "Happy birthday! Treat yourself.", bookingUrl: siteUrl(business) }), vars };
    case "order": return { ...orderEmail(brand, { number: 1043, lines: [{ name: "Lash cleanser", quantity: 2, amount: money(36) }], total: money(38.16), method: "pickup", address: null }), vars };
  }
}

/** What the designer needs to preview a business's emails: its brand, postal address and sample field values. */
export async function designerContext(business: Business) {
  const address = await withTenant(business.id, (tx) => postalAddress(tx, business));
  const brandCtx = businessBrand(business, address);
  const vars: Record<string, string> = { ...SAMPLE_VARS, business: business.name, business_phone: business.phone ?? "", business_address: address ?? "", booking_url: siteUrl(business), unsubscribe_url: appUrl(`/unsubscribe/${business.slug}/sample`) };
  return { brandCtx, brand: brandOf(brandCtx), address, vars };
}
