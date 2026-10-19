/**
 * Settings → Billing with Stripe stood in: the invoice list as the page loads it (server/billing-overview.ts) and shows
 * it (the Invoices card), the upcoming-invoice preview, and what happens when Stripe cannot be reached.
 */
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { method: string; params: unknown }[] = [];
let invoicesList: (params: Record<string, unknown>) => unknown;
let fail = false;

vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: () => true,
  stripe: () => ({
    invoices: {
      list: async (params: Record<string, unknown>) => {
        calls.push({ method: "invoices.list", params });
        if (fail) throw new Error("connect ETIMEDOUT");
        return invoicesList(params);
      },
      createPreview: async (params: Record<string, unknown>) => {
        calls.push({ method: "invoices.createPreview", params });
        if (fail) throw new Error("connect ETIMEDOUT");
        return {
          total: 2560,
          lines: {
            data: [
              { amount: 1500, quantity: 1, description: "1 × Angelic Booking (at $15.00 / month)", pricing: { price_details: { product: "angelic_platform", price: "price_1" }, unit_amount_decimal: "1500" }, parent: { subscription_item_details: { proration: false } } },
              { amount: 1000, quantity: 1, description: "1 × Additional staff member (at $10.00 / month)", pricing: { price_details: { product: "angelic_extra_staff", price: "price_2" }, unit_amount_decimal: "1000" }, parent: { subscription_item_details: { proration: false } } },
              { amount: 60, quantity: 130, description: "Text messages", pricing: { price_details: { product: "angelic_sms_usage", price: "price_3" }, unit_amount_decimal: null }, parent: { subscription_item_details: { proration: false } } },
            ],
          },
        };
      },
    },
    subscriptions: {
      retrieve: async () => {
        calls.push({ method: "subscriptions.retrieve", params: null });
        if (fail) throw new Error("connect ETIMEDOUT");
        return {
          status: "active",
          trial_end: null,
          cancel_at: null,
          cancel_at_period_end: false,
          default_payment_method: { card: { brand: "visa", display_brand: null, last4: "4242" } },
          items: { data: [{ current_period_start: 1_760_000_000, current_period_end: 1_762_678_400 }] },
        };
      },
    },
    customers: { retrieve: async () => ({ deleted: false, invoice_settings: { default_payment_method: null } }) },
  }),
}));
// The card's portal button is a server action; the test only needs it to exist.
vi.mock("../../app/app/[slug]/settings/billing/actions", () => ({ openPortalAction: async () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
(globalThis as unknown as { React: typeof React }).React = React;

const inv = (n: number, extra: Partial<{ status: string; total: number; invoice_pdf: string | null; hosted_invoice_url: string | null; number: string | null }> = {}) => ({
  id: `in_${n}`,
  number: `LUXE-${String(n).padStart(4, "0")}`,
  created: 1_760_000_000 - n * 86_400 * 30,
  total: 2500,
  currency: "usd",
  status: "paid",
  hosted_invoice_url: `https://invoice.stripe.com/i/${n}`,
  invoice_pdf: `https://pay.stripe.com/invoice/${n}/pdf`,
  ...extra,
});

const business = { stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" };

beforeEach(() => {
  calls.length = 0;
  fail = false;
  invoicesList = () => ({ data: [], has_more: false });
});

describe("the invoice list", () => {
  it("asks Stripe for the newest 12 of this customer and leaves drafts out", async () => {
    const { listInvoices } = await import("@/server/billing-overview");
    invoicesList = () => ({ data: [inv(0, { status: "draft", number: null, invoice_pdf: null, hosted_invoice_url: null }), inv(1), inv(2, { status: "open" }), inv(3, { status: "void", total: 0 }), inv(4, { status: "uncollectible" })], has_more: false });
    const page = await listInvoices(business);
    expect(calls[0]).toEqual({ method: "invoices.list", params: { customer: "cus_1", limit: 12 } });
    expect(page.rows.map((r) => [r.number, r.status, r.amountCents, r.url])).toEqual([
      ["LUXE-0001", "paid", 2500, "https://pay.stripe.com/invoice/1/pdf"],
      ["LUXE-0002", "open", 2500, "https://pay.stripe.com/invoice/2/pdf"],
      ["LUXE-0003", "void", 0, "https://pay.stripe.com/invoice/3/pdf"],
      ["LUXE-0004", "uncollectible", 2500, "https://pay.stripe.com/invoice/4/pdf"],
    ]);
    expect(page).toMatchObject({ olderAfter: null, newerBefore: null, reachable: true });
  });

  it("pages 12 at a time with Stripe's cursors in both directions", async () => {
    const { listInvoices } = await import("@/server/billing-overview");
    invoicesList = () => ({ data: Array.from({ length: 12 }, (_, i) => inv(i + 1)), has_more: true });
    const first = await listInvoices(business);
    expect(first).toMatchObject({ olderAfter: "in_12", newerBefore: null });

    invoicesList = () => ({ data: Array.from({ length: 5 }, (_, i) => inv(i + 13)), has_more: false });
    const older = await listInvoices(business, { after: "in_12" });
    expect(calls[1]!.params).toEqual({ customer: "cus_1", limit: 12, starting_after: "in_12" });
    expect(older).toMatchObject({ olderAfter: null, newerBefore: "in_13" });

    invoicesList = () => ({ data: Array.from({ length: 12 }, (_, i) => inv(i + 1)), has_more: false });
    const newer = await listInvoices(business, { before: "in_13" });
    expect(calls[2]!.params).toEqual({ customer: "cus_1", limit: 12, ending_before: "in_13" });
    expect(newer).toMatchObject({ olderAfter: "in_12", newerBefore: null });
  });

  it("is empty without a Stripe customer, and says so without calling Stripe", async () => {
    const { listInvoices } = await import("@/server/billing-overview");
    expect(await listInvoices({ stripeCustomerId: null })).toEqual({ rows: [], olderAfter: null, newerBefore: null, reachable: true });
    expect(calls).toEqual([]);
  });

  it("reports Stripe as unreachable instead of throwing", async () => {
    const { listInvoices } = await import("@/server/billing-overview");
    fail = true;
    expect(await listInvoices(business)).toMatchObject({ rows: [], reachable: false });
  });
});

describe("the Invoices card", () => {
  const render = async (props: Partial<Parameters<typeof import("../../app/app/[slug]/settings/billing/invoices-card").InvoicesCard>[0]>) => {
    const { InvoicesCard } = await import("../../app/app/[slug]/settings/billing/invoices-card");
    return renderToString(createElement(InvoicesCard, { slug: "luxe", page: { rows: [], olderAfter: null, newerBefore: null, reachable: true }, hasCustomer: true, portalEnabled: true, timezone: "America/New_York", email: "owner@luxe.test", ...props })).replace(/<!-- -->/g, "");
  };

  it("lists number, date in the business timezone, amount, status and the PDF link, newest first, with paging and the portal button", async () => {
    const { listInvoices } = await import("@/server/billing-overview");
    invoicesList = () => ({ data: [inv(1, { status: "open" }), inv(2, { total: 1234 })], has_more: true });
    const page = await listInvoices(business, { after: "in_0" });
    const html = await render({ page });
    expect(html.indexOf("LUXE-0001")).toBeLessThan(html.indexOf("LUXE-0002"));
    expect(html).toContain('href="https://pay.stripe.com/invoice/1/pdf"');
    expect(html).toContain("Sep 9, 2025"); // 1_760_000_000 − 30 days, in New York
    expect(html).toContain("$12.34");
    expect(html).toContain(">Open<");
    expect(html).toContain(">Paid<");
    expect(html).toContain("Manage payment method");
    expect(html).toContain('href="/app/luxe/settings/billing?after=in_2"');
    expect(html).toContain('href="/app/luxe/settings/billing?before=in_1"');
  });

  it("explains the empty states: no customer yet, nothing issued yet, Stripe unreachable", async () => {
    expect(await render({ hasCustomer: false })).toContain("Your first invoice is issued when the subscription starts");
    expect(await render({ hasCustomer: false })).not.toContain("Manage payment method");
    expect(await render({})).toContain("emailed to owner@luxe.test");
    const down = await render({ page: { rows: [], olderAfter: null, newerBefore: null, reachable: false } });
    expect(down).toContain("Invoices are unavailable right now");
    expect(down).toContain("Stripe could not be reached");
  });
});

describe("the upcoming-invoice preview", () => {
  it("reads the period, card and lines from Stripe", async () => {
    const { stripeOverview } = await import("@/server/billing-overview");
    const o = await stripeOverview(business);
    expect(o.reachable).toBe(true);
    expect(o.subscription).toMatchObject({ status: "active", card: { brand: "visa", last4: "4242" }, periodStart: new Date(1_760_000_000_000), periodEnd: new Date(1_762_678_400_000), trialEnd: null, cancelAt: null });
    expect(o.preview).toEqual({
      totalCents: 2560,
      lines: [
        { product: "angelic_platform", description: "1 × Angelic Booking (at $15.00 / month)", amountCents: 1500, quantity: 1, unitAmountDecimal: "1500", proration: false },
        { product: "angelic_extra_staff", description: "1 × Additional staff member (at $10.00 / month)", amountCents: 1000, quantity: 1, unitAmountDecimal: "1000", proration: false },
        { product: "angelic_sms_usage", description: "Text messages", amountCents: 60, quantity: 130, unitAmountDecimal: null, proration: false },
      ],
    });
  });

  it("is a fallback, not an error, when Stripe is down or the business has no subscription", async () => {
    const { stripeOverview } = await import("@/server/billing-overview");
    fail = true;
    expect(await stripeOverview(business)).toEqual({ reachable: false, subscription: null, preview: null });
    fail = false;
    expect(await stripeOverview({ stripeCustomerId: "cus_1", stripeSubscriptionId: null })).toEqual({ reachable: true, subscription: null, preview: null });
    expect(calls.filter((c) => c.method !== "invoices.list").length).toBe(1); // only the failed retrieve
  });
});
