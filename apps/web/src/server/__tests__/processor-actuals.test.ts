/** The processor-actuals totals: Stripe balance transactions and Helcim batches closed on a day. Pure, no network. */
import { describe, expect, it } from "vitest";
import { batchesClosedOn, totalBalance } from "@/server/processor-actuals";

describe("processor actuals", () => {
  it("totals Stripe balance transactions, leaving payouts out", () => {
    expect(totalBalance([
      { type: "charge", amount: 10_000, fee: 320, net: 9680 },
      { type: "payment", amount: 2500, fee: 103, net: 2397 },
      { type: "refund", amount: -3000, fee: 0, net: -3000 },
      { type: "stripe_fee", amount: -200, fee: 0, net: -200 },
      { type: "payout", amount: -50_000, fee: 0, net: -50_000 },
    ])).toEqual({ grossCents: 12_500, refundsCents: 3000, feesCents: 423, netCents: 8877 });
  });

  it("keeps only Helcim batches closed on the day, in cents", () => {
    const rows = batchesClosedOn([
      { id: 1, dateCreated: "2026-10-21 17:00:01", dateClosed: "2026-10-22 17:00:00", closed: 1, totalSales: 812.5, totalRefunds: 20, totalReversed: 5, netSales: 787.5, countApproved: 9 },
      { id: 2, dateCreated: "2026-10-22 17:00:01", dateClosed: null, closed: 0, totalSales: 100 },
      { id: 0, dateCreated: "2026-10-20 17:00:01", dateClosed: "2026-10-21 17:00:00", closed: 1, totalSales: 1 },
    ], "2026-10-22");
    expect(rows).toEqual([{ id: 1, closedAt: "2026-10-22 17:00:00", salesCents: 81_250, refundsCents: 2500, netCents: 78_750, count: 9 }]);
  });
});
