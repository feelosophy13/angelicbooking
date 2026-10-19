import { describe, expect, it } from "vitest";
import { DEFAULT_PRICE_BOOK, type PriceBook } from "@angelic/core/platform-pricing";
import { PRODUCT_IDS } from "../billing-config";
import { invoiceRow, monthStartIn, previewBreakdown, priceBookBreakdown, pricingOverrides, type PreviewLine } from "../billing-breakdown";

// The price book decided on 2026-10-19.
const book: PriceBook = { ...DEFAULT_PRICE_BOOK, baseCents: 1500, includedLocations: 1, perLocationCents: 2900, includedStaff: 1, perStaffCents: 1000, numberCents: 1500, smsIncluded: 100, smsUsageCents: 2, trialDays: 30, trialEmailCap: 200 };
const noNumbers: { phoneNumber: string; monthlyFeeCents: number }[] = [];

describe("priceBookBreakdown (trial, or Stripe unreachable)", () => {
  it("is the plan and the free text allowance inside the allowances", () => {
    const b = priceBookBreakdown(book, { locations: 1, activeStaff: 1, numbers: noNumbers, smsSent: 12 }, "usd");
    expect(b.lines.map((l) => [l.kind, l.cents])).toEqual([["base", 1500], ["sms", 0]]);
    expect(b.lines[0]).toMatchObject({ label: "Plan", detail: "includes 1 location and 1 staff member" });
    expect(b.lines[1]!.detail).toBe("12 texts sent, 100 included, then $0.02 each");
    expect(b).toMatchObject({ recurringCents: 1500, usageCents: 0, totalCents: 1500, extraStaff: 0, extraLocations: 0, smsOverage: 0 });
  });

  it("prices extra staff and locations by count × unit, the number at what it was bought for, and texts over the allowance at 2¢", () => {
    const b = priceBookBreakdown(book, { locations: 3, activeStaff: 5, numbers: [{ phoneNumber: "+18663292807", monthlyFeeCents: 1500 }], smsSent: 130 }, "usd");
    expect(b.lines.map((l) => `${l.label}: ${l.detail} = ${l.cents}`)).toEqual([
      "Plan: includes 1 location and 1 staff member = 1500",
      "Extra staff: 4 extra staff members × $10.00 = 4000",
      "Extra locations: 2 extra locations × $29.00 = 5800",
      "Dedicated text number: +18663292807 = 1500",
      "Text messages: 130 texts sent, 100 included, 30 × $0.02 = 60",
    ]);
    expect(b).toMatchObject({ recurringCents: 12800, usageCents: 60, totalCents: 12860, extraStaff: 4, extraLocations: 2, smsOverage: 30 });
  });

  it("uses one extra staff member in the singular and the business currency", () => {
    const b = priceBookBreakdown(book, { locations: 1, activeStaff: 2, numbers: noNumbers, smsSent: 0 }, "cad");
    expect(b.lines[1]!.detail).toBe("1 extra staff member × CA$10.00");
  });

  it("leaves out extras that are free and the text line when texts are neither included nor charged", () => {
    const free = { ...book, perStaffCents: 0, perLocationCents: 0, smsIncluded: 0, smsUsageCents: 0 };
    const b = priceBookBreakdown(free, { locations: 4, activeStaff: 9, numbers: noNumbers, smsSent: 500 }, "usd");
    expect(b.lines.map((l) => l.kind)).toEqual(["base"]);
    expect(b.totalCents).toBe(1500);
  });

  it("keeps a $0 plan as a line so the page can say the platform is free", () => {
    const b = priceBookBreakdown({ ...book, baseCents: 0 }, { locations: 1, activeStaff: 1, numbers: noNumbers, smsSent: 0 }, "usd");
    expect(b.lines[0]).toMatchObject({ kind: "base", cents: 0 });
  });
});

describe("previewBreakdown (Stripe's upcoming invoice)", () => {
  const line = (product: string | null, amountCents: number, quantity: number | null, unit: string | null, extra: Partial<PreviewLine> = {}): PreviewLine => ({ product, description: null, amountCents, quantity, unitAmountDecimal: unit, proration: false, ...extra });

  it("takes amounts and quantities from Stripe and words them from the price book", () => {
    const preview = {
      lines: [line(PRODUCT_IDS.base, 1500, 1, "1500"), line(PRODUCT_IDS.staff, 4000, 4, "1000"), line(PRODUCT_IDS.number, 1500, 1, "1500"), line(PRODUCT_IDS.usage, 60, 130, null)],
      totalCents: 7060,
    };
    const b = previewBreakdown(preview, book, { numbers: [{ phoneNumber: "+18663292807", monthlyFeeCents: 1500 }] }, "usd");
    expect(b.lines.map((l) => `${l.label}: ${l.detail} = ${l.cents}`)).toEqual([
      "Plan: includes 1 location and 1 staff member = 1500",
      "Extra staff: 4 extra staff members × $10.00 = 4000",
      "Dedicated text number: +18663292807 = 1500",
      "Text messages: 130 texts sent, 100 included, 30 × $0.02 = 60",
    ]);
    expect(b).toMatchObject({ totalCents: 7060, usageCents: 60, recurringCents: 7000, extraStaff: 4, extraLocations: 0, smsOverage: 30 });
  });

  it("shows a custom price as Stripe charges it, not the list price", () => {
    const b = previewBreakdown({ lines: [line(PRODUCT_IDS.base, 900, 1, "900"), line(PRODUCT_IDS.staff, 1500, 3, "500")], totalCents: 2400 }, book, { numbers: noNumbers }, "usd");
    expect(b.lines[0]).toMatchObject({ kind: "base", unitCents: 900, cents: 900 });
    expect(b.lines[1]!.detail).toBe("3 extra staff members × $5.00");
  });

  it("folds prorations into one adjustments line and shows tax as the difference to Stripe's total", () => {
    const preview = {
      lines: [
        line(PRODUCT_IDS.base, 1500, 1, "1500"),
        line(PRODUCT_IDS.staff, 1000, 1, "1000"),
        line(PRODUCT_IDS.staff, 333, 1, "1000", { proration: true, description: "Remaining time on 1 × Additional staff member after 12 Oct 2026" }),
        line(PRODUCT_IDS.staff, -200, 1, "1000", { proration: true, description: "Unused time on 1 × Additional staff member after 12 Oct 2026" }),
      ],
      totalCents: 2765, // 2633 + 132 tax
    };
    const b = previewBreakdown(preview, book, { numbers: noNumbers }, "usd");
    expect(b.lines.map((l) => [l.label, l.cents])).toEqual([["Plan", 1500], ["Extra staff", 1000], ["Text messages", 0], ["Adjustments", 133], ["Tax", 132]]);
    expect(b.lines[3]!.detail).toContain("Remaining time");
    expect(b.totalCents).toBe(2765);
  });

  it("words a flat per-text price from before texts were included as Stripe charges it", () => {
    const b = previewBreakdown({ lines: [line(PRODUCT_IDS.base, 0, 1, "0"), line(PRODUCT_IDS.usage, 4, 2, "2")], totalCents: 4 }, book, { numbers: noNumbers }, "usd");
    expect(b.lines[1]).toMatchObject({ kind: "sms", detail: "2 texts sent × $0.02", cents: 4, unitCents: 2 });
  });

  it("still shows the text allowance when no text has been metered yet", () => {
    const b = previewBreakdown({ lines: [line(PRODUCT_IDS.base, 1500, 1, "1500")], totalCents: 1500 }, book, { numbers: noNumbers }, "usd");
    expect(b.lines.map((l) => l.kind)).toEqual(["base", "sms"]);
    expect(b.lines[1]!.detail).toBe("0 texts sent, 100 included, then $0.02 each");
  });
});

describe("pricingOverrides (Your pricing)", () => {
  it("is empty at list price, including an override equal to the list price", () => {
    expect(pricingOverrides(book, null, "usd")).toEqual([]);
    expect(pricingOverrides(book, { baseCents: 1500, perStaffCents: null }, "usd")).toEqual([]);
  });
  it("names each line the platform changed for this business, with the standard price beside it", () => {
    const out = pricingOverrides(book, { baseCents: 900, perStaffCents: 500, smsIncluded: 500, platformFeeBps: 150, trialDays: 60 }, "usd");
    expect(out.map((o) => `${o.label}: ${o.value} (standard ${o.standard})`)).toEqual([
      "Plan: $9.00 / month (standard $15.00 / month)",
      "Each extra staff member: $5.00 / month (standard $10.00 / month)",
      "Texts included each month: 500 (standard 100)",
      "Free trial: 60 days (standard 30 days)",
      "Platform fee on card payments: 1.5% (standard 0%)",
    ]);
  });
});

describe("invoiceRow", () => {
  it("keeps number, date, total, status and the PDF link, and treats anything unknown as a draft", () => {
    const r = invoiceRow({ id: "in_1", number: "ABCD-0001", created: 1_760_000_000, total: 2500, currency: "usd", status: "paid", hosted_invoice_url: "https://invoice.stripe.com/i/x", invoice_pdf: "https://pay.stripe.com/invoice/x/pdf" });
    expect(r).toEqual({ id: "in_1", number: "ABCD-0001", at: new Date(1_760_000_000_000), amountCents: 2500, currency: "usd", status: "paid", url: "https://pay.stripe.com/invoice/x/pdf" });
    expect(invoiceRow({ id: "in_2", number: null, created: 1, total: 0, currency: "usd", status: "draft" })).toMatchObject({ number: "in_2", status: "draft", url: null });
    expect(invoiceRow({ id: "in_3", number: "X", created: 1, total: 0, currency: "usd", status: "weird" }).status).toBe("draft");
  });
});

describe("monthStartIn", () => {
  it("is midnight on the 1st in the business's timezone", () => {
    // 2026-10-19 03:30 UTC is still 18 Oct in Los Angeles; the month started 1 Oct 00:00 PDT = 07:00 UTC.
    expect(monthStartIn("America/Los_Angeles", new Date("2026-10-19T03:30:00Z")).toISOString()).toBe("2026-10-01T07:00:00.000Z");
    expect(monthStartIn("America/New_York", new Date("2026-10-19T03:30:00Z")).toISOString()).toBe("2026-10-01T04:00:00.000Z");
    // 1 Nov 00:30 UTC is 31 Oct in New York, so October is still the month.
    expect(monthStartIn("America/New_York", new Date("2026-11-01T00:30:00Z")).toISOString()).toBe("2026-10-01T04:00:00.000Z");
  });
});
