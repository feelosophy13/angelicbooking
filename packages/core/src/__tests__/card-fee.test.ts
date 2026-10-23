import { describe, expect, it } from "vitest";
import { computeTotals } from "../pricing";
import { cardFeeFor, cardFeeLineName, cardFeeNotice, cardFeeOn, cardFeeRefundPart, cardFeeSettingsOf, splitGrossRefund, type CardFeeSettings } from "../card-fee";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const surcharge: CardFeeSettings = { type: "surcharge", bps: 300, cents: 0, desk: true, online: true, store: false, debitExempt: true };
const convenience: CardFeeSettings = { type: "convenience", bps: 0, cents: 250, desk: false, online: true, store: true, debitExempt: false };

describe("cardFeeFor", () => {
  it("is a percent of the card part, rounded to the cent", () => {
    expect(cardFeeFor(surcharge, "desk", 10_000, "credit")).toBe(300);
    expect(cardFeeFor(surcharge, "desk", 4_550, "credit")).toBe(137); // 136.5 rounds up
    expect(cardFeeFor({ ...surcharge, bps: 275 }, "desk", 10_000, "credit")).toBe(275);
  });
  it("never goes over 3%, even if a higher rate was stored", () => {
    expect(cardFeeFor({ ...surcharge, bps: 450 }, "desk", 10_000, "credit")).toBe(300);
    expect(cardFeeSettingsOf({ cardFeeType: "surcharge", cardFeeBps: 900, cardFeeCents: 0, cardFeeDesk: true, cardFeeOnline: true, cardFeeStore: true, cardFeeDebitExempt: true }).bps).toBe(300);
  });
  it("is flat for a convenience fee", () => {
    expect(cardFeeFor(convenience, "online", 1_000, "credit")).toBe(250);
    expect(cardFeeFor(convenience, "store", 99_999, "debit")).toBe(250); // debit not exempted by this salon
  });
  it("is nothing off, outside the chosen channels, or on nothing", () => {
    expect(cardFeeFor({ ...surcharge, type: "off" }, "desk", 10_000, "credit")).toBe(0);
    expect(cardFeeFor(surcharge, "store", 10_000, "credit")).toBe(0);
    expect(cardFeeFor(convenience, "desk", 10_000, "credit")).toBe(0);
    expect(cardFeeFor(surcharge, "desk", 0, "credit")).toBe(0);
    expect(cardFeeOn({ ...surcharge, bps: 0 }, "desk")).toBe(false);
  });
  it("leaves debit, prepaid and unidentified cards alone when debit is exempt", () => {
    expect(cardFeeFor(surcharge, "desk", 10_000, "debit")).toBe(0);
    expect(cardFeeFor(surcharge, "desk", 10_000, "prepaid")).toBe(0);
    expect(cardFeeFor(surcharge, "desk", 10_000, "unknown")).toBe(0);
    expect(cardFeeFor({ ...surcharge, debitExempt: false }, "desk", 10_000, "unknown")).toBe(300);
  });
});

describe("wording", () => {
  it("tells the client before they pay", () => {
    expect(cardFeeNotice(surcharge, money, { cashOption: true })).toBe("A 3% card fee applies. Pay cash to avoid it. Debit cards: no fee.");
    expect(cardFeeNotice({ ...surcharge, bps: 275, debitExempt: false }, money, { cashOption: false })).toBe("A 2.75% card fee applies.");
    expect(cardFeeNotice(convenience, money, { cashOption: false })).toBe("A $2.50 convenience fee applies to card payments.");
    expect(cardFeeLineName(surcharge, money)).toBe("Card surcharge (3%)");
    expect(cardFeeLineName({ ...surcharge, bps: 250 }, money)).toBe("Card surcharge (2.5%)");
  });
});

describe("refunds give the fee back in proportion", () => {
  // $100 paid by card plus a $3 fee.
  const paid = { amountCents: 10_300, surchargeCents: 300, returnedCents: 0, surchargeReturnedCents: 0 };
  it("a partial refund takes its share of the fee", () => {
    expect(cardFeeRefundPart(paid, 4_000)).toBe(120);
    expect(cardFeeRefundPart(paid, 3_333)).toBe(100);
  });
  it("refunding the rest returns exactly what is left of the fee", () => {
    const after = { ...paid, returnedCents: 3_333 + 100, surchargeReturnedCents: 100 };
    expect(cardFeeRefundPart(after, 3_333)).toBe(100);
    const later = { ...after, returnedCents: after.returnedCents + 3_433, surchargeReturnedCents: 200 };
    expect(cardFeeRefundPart(later, 3_334)).toBe(100);
    expect(cardFeeRefundPart(later, 99_999)).toBe(100);
  });
  it("a payment with no fee gives none back", () => {
    expect(cardFeeRefundPart({ amountCents: 5_000, surchargeCents: 0, returnedCents: 0, surchargeReturnedCents: 0 }, 2_000)).toBe(0);
  });
  it("splits a refund made in Stripe's dashboard the same way", () => {
    expect(splitGrossRefund(paid, 5_150)).toEqual({ baseCents: 5_000, feeCents: 150 });
    expect(splitGrossRefund(paid, 10_300)).toEqual({ baseCents: 10_000, feeCents: 300 });
    expect(splitGrossRefund({ ...paid, surchargeCents: 0, amountCents: 10_000 }, 500)).toEqual({ baseCents: 500, feeCents: 0 });
  });
});

describe("the fee on a ticket", () => {
  it("is added after the discount and tax, and neither touches it", () => {
    const t = computeTotals(
      [
        { kind: "service", amountCents: 10_000, taxable: false },
        { kind: "product", amountCents: 2_000, taxable: true },
        { kind: "tip", amountCents: 1_500, taxable: false },
        { kind: "card_fee", amountCents: 390, taxable: false },
      ],
      { type: "percent", value: 10 },
      1_000,
    );
    expect(t).toEqual({ subtotalCents: 12_000, discountCents: 1_200, taxCents: 180, tipCents: 1_500, cardFeeCents: 390, totalCents: 12_000 - 1_200 + 180 + 1_500 + 390 });
  });
});
