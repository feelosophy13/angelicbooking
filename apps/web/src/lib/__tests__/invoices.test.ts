// Invoice rules: status, deposit, what the client may pay now, and which reminder is due.
import { describe, expect, it } from "vitest";
import { depositCents, invoiceState, payOptions, reminderDue, INVOICE_TOKEN_RE } from "@/lib/invoices";
import { shiftISODate } from "@/lib/utils";

const inv = (o: Partial<Parameters<typeof invoiceState>[0]> = {}) => ({ status: "sent" as const, dueOn: "2026-11-10", viewedAt: null, ...o });
const sale = (o: Partial<Parameters<typeof invoiceState>[1]> = {}) => ({ status: "open" as const, totalCents: 10_000, paidCents: 0, ...o });

describe("invoice status", () => {
  const today = "2026-11-01";
  it("walks draft → sent → viewed → partly paid → paid", () => {
    expect(invoiceState(inv({ status: "draft" }), sale(), today)).toBe("draft");
    expect(invoiceState(inv(), sale(), today)).toBe("sent");
    expect(invoiceState(inv({ viewedAt: new Date() }), sale(), today)).toBe("viewed");
    expect(invoiceState(inv({ viewedAt: new Date() }), sale({ paidCents: 2500 }), today)).toBe("partly_paid");
    expect(invoiceState(inv(), sale({ status: "paid", paidCents: 10_000 }), today)).toBe("paid");
  });
  it("is overdue once sent and past the due date, part paid or not; paid and void win", () => {
    expect(invoiceState(inv({ dueOn: "2026-10-31" }), sale(), today)).toBe("overdue");
    expect(invoiceState(inv({ dueOn: "2026-10-31" }), sale({ paidCents: 5000 }), today)).toBe("overdue");
    expect(invoiceState(inv({ dueOn: "2026-11-01" }), sale(), today)).toBe("sent"); // due today is not late yet
    expect(invoiceState(inv({ dueOn: null }), sale(), today)).toBe("sent");
    expect(invoiceState(inv({ status: "draft", dueOn: "2026-10-01" }), sale(), today)).toBe("draft");
    expect(invoiceState(inv({ dueOn: "2026-10-31" }), sale({ status: "refunded" }), today)).toBe("paid");
    expect(invoiceState(inv({ status: "void" }), sale(), today)).toBe("void");
    expect(invoiceState(inv(), sale({ status: "void" }), today)).toBe("void");
  });
});

describe("deposit and amount due now", () => {
  it("takes a percent of the total or an amount up to it", () => {
    expect(depositCents({ type: "percent", value: 50 }, 83_000)).toBe(41_500);
    expect(depositCents({ type: "percent", value: 33 }, 1001)).toBe(330);
    expect(depositCents({ type: "amount", value: 20_000 }, 15_000)).toBe(15_000);
    expect(depositCents(null, 15_000)).toBeNull();
  });
  it("asks for the rest of the deposit first, then anything up to the balance", () => {
    const dep = { type: "percent" as const, value: 50 };
    expect(payOptions(dep, { totalCents: 80_000, paidCents: 0 })).toEqual({ balanceCents: 80_000, depositDueCents: 40_000, minCents: 40_000 });
    expect(payOptions(dep, { totalCents: 80_000, paidCents: 10_000 })).toEqual({ balanceCents: 70_000, depositDueCents: 30_000, minCents: 30_000 });
    // Deposit met (by any payment): the client pays what they like, from $1.
    expect(payOptions(dep, { totalCents: 80_000, paidCents: 40_000 })).toEqual({ balanceCents: 40_000, depositDueCents: null, minCents: 100 });
    expect(payOptions(null, { totalCents: 80, paidCents: 0 })).toEqual({ balanceCents: 80, depositDueCents: null, minCents: 80 });
    expect(payOptions(null, { totalCents: 5000, paidCents: 5000 }).balanceCents).toBe(0);
  });
});

describe("reminders", () => {
  const due = "2026-11-10";
  const at = (today: string, sentOn = "2026-11-01", sent: string[] = []) => reminderDue(due, today, sentOn, sent, shiftISODate);
  it("sends three days before, on the day, a day after and a week after", () => {
    expect(at("2026-11-06")).toBeNull();
    expect(at("2026-11-07")).toEqual({ key: "before", markAlso: [] });
    expect(at("2026-11-10", "2026-11-01", ["before"])).toEqual({ key: "due", markAlso: [] });
    expect(at("2026-11-11", "2026-11-01", ["before", "due"])).toEqual({ key: "after_1", markAlso: [] });
    expect(at("2026-11-17", "2026-11-01", ["before", "due", "after_1"])).toEqual({ key: "after_7", markAlso: [] });
    expect(at("2026-11-30", "2026-11-01", ["before", "due", "after_1", "after_7"])).toBeNull();
  });
  it("sends only the latest step after a gap, and nothing on the day the invoice went out", () => {
    expect(at("2026-11-12")).toEqual({ key: "after_1", markAlso: ["before", "due"] });
    expect(at("2026-11-08", "2026-11-08")).toBeNull();
    expect(at("2026-11-12", "2026-11-12")).toBeNull();
  });
});

describe("invoice link tokens", () => {
  it("accepts only 43 base64url characters", () => {
    expect(INVOICE_TOKEN_RE.test("a".repeat(43))).toBe(true);
    expect(INVOICE_TOKEN_RE.test("a".repeat(42))).toBe(false);
    expect(INVOICE_TOKEN_RE.test(`${"a".repeat(42)}'`)).toBe(false);
  });
});
