import { describe, expect, it } from "vitest";
import { buildTip, type TipItem } from "../calendar-tip";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const item = (over: Partial<TipItem> = {}): TipItem => ({ appointmentId: "a1", serviceName: "Hybrid Full Set", staffName: "Ava", startMin: 600, endMin: 720, priceCents: 15000, status: "confirmed", clientName: "Jo Lee", clientPhone: "+17035551001", clientTags: ["VIP"], source: "online", depositCents: 5000, depositStatus: "paid", notes: "Sensitive eyes", ...over });

describe("buildTip", () => {
  it("describes a visit: client, phone, status, tags, how it was booked and the deposit", () => {
    const t = buildTip([item()], { money, formsDue: false });
    expect(t).toMatchObject({ kind: "visit", heading: "Jo Lee", sub: "+17035551001", status: "Confirmed", tags: ["VIP"], notes: "Sensitive eyes" });
    expect(t.facts).toEqual(["Booked online", "Deposit $50.00 paid"]);
    expect(t.lines).toEqual([{ service: "Hybrid Full Set", staff: "Ava", startMin: 600, endMin: 720, price: "$150.00" }]);
    expect(t.total).toBeNull(); // one service: the line already says it
  });
  it("lists every service on the visit and totals them", () => {
    const t = buildTip([item(), item({ serviceName: "Brow Tint", staffName: "Sofia", startMin: 720, endMin: 750, priceCents: 3500 })], { money, formsDue: true });
    expect(t.lines.map((l) => l.service)).toEqual(["Hybrid Full Set", "Brow Tint"]);
    expect(t.total).toBe("$185.00");
    expect(t.facts).toContain("Forms due");
  });
  it("merges a service's processing segment into one line", () => {
    const t = buildTip([item({ serviceName: "Lash Lift", startMin: 600, endMin: 630, priceCents: 9000 }), item({ serviceName: "Lash Lift (finish)", startMin: 660, endMin: 690, priceCents: 0 })], { money, formsDue: false });
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toMatchObject({ service: "Lash Lift", startMin: 600, endMin: 690 });
  });
  it("calls a clientless visit a walk-in and clips long notes", () => {
    const t = buildTip([item({ clientName: null, clientPhone: null, notes: "x".repeat(300) })], { money, formsDue: false });
    expect(t.heading).toBe("Walk-in");
    expect(t.notes!.length).toBeLessThanOrEqual(180);
    expect(t.notes!.endsWith("…")).toBe(true);
  });
  it("shows a block by its reason and a class by its seats", () => {
    expect(buildTip([item({ kind: "block", serviceName: "Blocked · Lunch", clientName: null })], { money, formsDue: false })).toMatchObject({ kind: "block", heading: "Lunch", status: "Blocked time" });
    expect(buildTip([item({ classSessionId: "c1", serviceName: "Lash Foundations", status: "class", seats: { booked: 3, capacity: 6 } })], { money, formsDue: false })).toMatchObject({ kind: "class", heading: "Lash Foundations", sub: "3 of 6 seats taken" });
  });
});
