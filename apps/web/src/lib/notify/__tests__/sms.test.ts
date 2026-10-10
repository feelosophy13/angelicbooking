import { describe, expect, it } from "vitest";
import { renderSms, smsBody, SMS_DEFAULTS } from "../sms";
import type { ApptContext } from "../templates";

const ctx: ApptContext = {
  businessName: "Angelic Salon",
  businessPhone: null,
  address: null,
  timeZone: "America/Los_Angeles",
  clientFirstName: "Maria",
  services: "Brow Lamination",
  staffName: "Sam",
  startAt: new Date("2026-10-14T17:00:00Z"),
  manageUrl: "https://x/manage/abc",
  policy: null,
  cancelWindowHours: 24,
  depositPaid: "$25.00",
  formsUrl: null,
};

describe("sms wording", () => {
  it("fills placeholders and collapses whitespace", () => {
    expect(renderSms("Hi {first_name},  see  you {when}", { first_name: "Maria", when: "soon" })).toBe("Hi Maria, see you soon");
  });
  it("uses the default and appends the deposit line", () => {
    const body = smsBody({ smsTemplates: {} }, "confirmation", ctx);
    expect(body).toContain("Angelic Salon: you're booked for Brow Lamination with Sam on Wednesday, October 14 at 10:00 AM.");
    expect(body).toContain("Deposit paid: $25.00.");
    expect(body).not.toContain("STOP");
  });
  it("prefers the business's own wording verbatim", () => {
    const body = smsBody({ smsTemplates: { confirmation: "{business}: {service} on {when}. See you!" } }, "confirmation", ctx);
    expect(body).toBe("Angelic Salon: Brow Lamination on Wednesday, October 14 at 10:00 AM. See you!");
  });
  it("has a default for every template key", () => {
    for (const v of Object.values(SMS_DEFAULTS)) expect(v).toContain("{business}");
  });
});
