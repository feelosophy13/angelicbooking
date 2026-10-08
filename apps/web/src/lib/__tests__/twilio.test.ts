import { describe, expect, it } from "vitest";
import { encodeParams, tollfreeParams, twilioSignature, validateTwilioSignature } from "../twilio";

describe("twilio helpers", () => {
  it("signs webhooks the way Twilio does (URL + params sorted by key)", () => {
    // Reference vector from twilio-node's own webhook test suite.
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    const params = { CallSid: "CA1234567890ABCDE", Caller: "+14158675309", Digits: "1234", From: "+14158675309", To: "+18005551212" };
    expect(twilioSignature("12345", url, params)).toBe("RSOYDt4T1cUTdK1PDd93/VVr8B8=");
    expect(validateTwilioSignature(url, params, "RSOYDt4T1cUTdK1PDd93/VVr8B8=", "12345")).toBe(true);
    expect(validateTwilioSignature(url, params, "nope", "12345")).toBe(false);
    expect(validateTwilioSignature(url, params, null, "12345")).toBe(false);
  });

  it("repeats array params and drops empty ones", () => {
    const p = encodeParams({ A: ["x", "y"], B: "1", C: undefined, D: "" });
    expect(p.getAll("A")).toEqual(["x", "y"]);
    expect(p.get("B")).toBe("1");
    expect(p.has("C")).toBe(false);
    expect(p.has("D")).toBe(false);
  });

  it("omits registration fields for sole proprietors and includes them otherwise", () => {
    const base = {
      tollfreePhoneNumberSid: "PN1",
      businessName: "Salon",
      businessWebsite: "https://salon.example",
      notificationEmail: "o@salon.example",
      businessRegistrationNumber: "123456789",
      useCaseCategories: ["ACCOUNT_NOTIFICATIONS"],
      useCaseSummary: "s",
      productionMessageSample: "m",
      optInImageUrls: ["https://salon.example/opt-in.png"],
      optInType: "WEB_FORM" as const,
      messageVolume: "1,000",
    };
    const sole = tollfreeParams({ ...base, businessType: "SOLE_PROPRIETOR" });
    expect(sole.BusinessRegistrationNumber).toBeUndefined();
    expect(sole.BusinessRegistrationAuthority).toBeUndefined();
    const llc = tollfreeParams({ ...base, businessType: "PRIVATE_PROFIT" });
    expect(llc.BusinessRegistrationNumber).toBe("123456789");
    expect(llc.BusinessRegistrationAuthority).toBe("EIN");
    expect(llc.BusinessCountry).toBe("US");
  });
});
