import { describe, expect, it } from "vitest";
import { sameClientName } from "../client-match";
import { clientIpFrom, formIp } from "../rate-limit";
import { scopesBeyond } from "../api-scopes";
import { PRIVATE_KINDS, PUBLIC_KINDS, SERVED_KINDS, visibilityOf } from "../files";

describe("sameClientName", () => {
  const jane = { firstName: "Jane", lastName: "Doe" };
  it("matches ignoring case, spacing, punctuation and accents", () => {
    expect(sameClientName(jane, { firstName: " jane ", lastName: "DOE" })).toBe(true);
    expect(sameClientName({ firstName: "Mary-Ann", lastName: "O'Neil" }, { firstName: "maryann", lastName: "oneil" })).toBe(true);
    expect(sameClientName({ firstName: "José", lastName: "Núñez" }, { firstName: "Jose", lastName: "Nunez" })).toBe(true);
    expect(sameClientName({ firstName: "지민", lastName: "박" }, { firstName: "지민", lastName: "박" })).toBe(true);
  });
  it("refuses a different person on the same phone or email", () => {
    expect(sameClientName(jane, { firstName: "John", lastName: "Doe" })).toBe(false);
    expect(sameClientName(jane, { firstName: "Jane", lastName: "Smith" })).toBe(false);
    expect(sameClientName(jane, { firstName: "", lastName: "Doe" })).toBe(false);
    expect(sameClientName({ firstName: "지민", lastName: "박" }, { firstName: "서연", lastName: "박" })).toBe(false);
  });
  it("matches on first name when the record has no last name (imports)", () => {
    expect(sameClientName({ firstName: "Jane", lastName: null }, { firstName: "Jane", lastName: "Doe" })).toBe(true);
    expect(sameClientName({ firstName: "Jane", lastName: "" }, { firstName: "Jane" })).toBe(true);
  });
});

describe("client IP", () => {
  const h = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});
  it("uses the hop our proxy added, not what the caller wrote", () => {
    expect(clientIpFrom(h("1.2.3.4, 203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIpFrom(h("203.0.113.9"))).toBe("203.0.113.9");
  });
  it("falls back to local in development, and records no address then", () => {
    expect(clientIpFrom(h())).toBe("local");
    expect(formIp(h())).toBeNull();
    expect(formIp(h("9.9.9.9, 198.51.100.7"))).toBe("198.51.100.7");
  });
});

describe("API key scopes", () => {
  const perms = (...a: string[]) => new Set(a);
  it("lets an owner grant anything", () => {
    expect(scopesBeyond(["pay:write", "roles:write"], perms(), true)).toEqual([]);
  });
  it("stops a role granting what it can't do itself", () => {
    expect(scopesBeyond(["pay:read", "roles:write", "settings:read", "catalog:read"], perms("business.manage", "services.manage"), false)).toEqual(["pay:read", "roles:write"]);
    expect(scopesBeyond(["clients:read", "clients:consent"], perms("clients.read"), false)).toEqual(["clients:consent"]);
    expect(scopesBeyond(["appointments:read", "appointments:book"], perms("appointments.read.any", "appointments.write.any"), false)).toEqual([]);
  });
  it("viewing clients alone grants none of the split client-data scopes", () => {
    expect(scopesBeyond(["clients:read", "client-notes:read", "clients:balances", "messages:read", "forms:read"], perms("clients.read"), false)).toEqual(["client-notes:read", "clients:balances", "messages:read", "forms:read"]);
  });
  it("settings scopes follow Business settings, not the keys permission that opens the API page", () => {
    expect(scopesBeyond(["settings:read", "settings:write", "policies:write", "settings:delete"], perms("business.manage"), false)).toEqual([]);
    expect(scopesBeyond(["settings:read", "policies:write", "catalog:read"], perms("integrations.manage", "billing.manage", "services.manage"), false)).toEqual(["settings:read", "policies:write"]);
    expect(scopesBeyond(["roles:read", "roles:write"], perms("business.manage", "integrations.manage"), false)).toEqual(["roles:read", "roles:write"]);
  });
  it("the phase 1 view permissions sit behind their scopes: staff, reviews, time, forms, sales and the waitlist", () => {
    expect(scopesBeyond(["staff:read", "reviews:read", "time:read", "time:write", "time:delete", "forms:write", "forms:void", "forms:delete", "sales:read", "waitlist:write"], perms("clients.read", "clients.write", "appointments.write.any", "reports.view", "payroll.view", "staff.manage"), false)).toEqual(["staff:read", "reviews:read", "time:read", "time:write", "time:delete", "forms:write", "forms:void", "forms:delete", "sales:read", "waitlist:write"]);
    expect(scopesBeyond(["staff:read"], perms("staff.schedules.view"), false)).toEqual([]);
    expect(scopesBeyond(["reviews:read"], perms("reviews.view"), false)).toEqual([]);
    expect(scopesBeyond(["reviews:read"], perms("reviews.view.own"), false)).toEqual(["reviews:read"]); // a key has no "own"
    expect(scopesBeyond(["time:read", "time:write"], perms("time.view.all"), false)).toEqual(["time:write"]);
    expect(scopesBeyond(["time:write", "time:delete"], perms("time.edit"), false)).toEqual([]);
    expect(scopesBeyond(["forms:read", "forms:write"], perms("clients.notes", "forms.manage"), false)).toEqual([]);
    expect(scopesBeyond(["sales:read"], perms("sales.view.all"), false)).toEqual([]);
    expect(scopesBeyond(["sales:read"], perms("sales.view.own", "checkout.take"), false)).toEqual(["sales:read"]);
    expect(scopesBeyond(["waitlist:write"], perms("waitlist.manage"), false)).toEqual([]);
  });
  it("each split scope follows its own permission", () => {
    expect(scopesBeyond(["client-notes:read", "client-notes:write", "forms:read"], perms("clients.read", "clients.notes"), false)).toEqual([]);
    expect(scopesBeyond(["clients:balances"], perms("clients.read", "clients.balances"), false)).toEqual([]);
    expect(scopesBeyond(["messages:read", "messages:write"], perms("clients.read", "clients.messages"), false)).toEqual(["messages:write"]);
    expect(scopesBeyond(["messages:write", "forms:write"], perms("clients.write"), false)).toEqual(["forms:write"]);
    expect(scopesBeyond(["client-notes:read"], perms("clients.write", "clients.messages", "clients.balances"), false)).toEqual(["client-notes:read"]);
  });
});

describe("file kinds", () => {
  it("keeps client photos private and every served kind in exactly one set", () => {
    expect(visibilityOf("client")).toBe("private");
    expect(PUBLIC_KINDS.has("client")).toBe(false);
    for (const k of SERVED_KINDS) expect(PUBLIC_KINDS.has(k) !== PRIVATE_KINDS.has(k)).toBe(true);
  });
});
