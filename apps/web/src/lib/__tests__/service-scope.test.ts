import { describe, expect, it } from "vitest";
import { NO_SCOPE, parseScope, scopeLabel, scopeValue } from "../service-scope";

const groups = [
  { id: "lash", name: "Lash Extensions", services: [], whole: { id: "c:lash", name: "All of Lash Extensions", meta: "" } },
  { id: "classic", name: "Lash Extensions › Classic", services: [{ id: "s1", name: "Classic Full Set", meta: "" }], whole: { id: "c:classic", name: "All of Classic", meta: "" } },
];

describe("service scope", () => {
  it("reads a service or a category the picker offers", () => {
    expect(parseScope("s1", groups)).toEqual({ serviceId: "s1", categoryId: null });
    expect(parseScope("c:lash", groups)).toEqual({ serviceId: null, categoryId: "lash" });
  });
  it("ignores anything it does not offer", () => {
    expect(parseScope("zzz", groups)).toEqual(NO_SCOPE);
    expect(parseScope("c:nope", groups)).toEqual(NO_SCOPE);
    expect(parseScope(null, groups)).toEqual(NO_SCOPE);
  });
  it("round-trips to the query value", () => {
    expect(scopeValue({ serviceId: "s1", categoryId: null })).toBe("s1");
    expect(scopeValue({ serviceId: null, categoryId: "lash" })).toBe("c:lash");
    expect(scopeValue(NO_SCOPE)).toBeNull();
  });
  it("names the scope for screen text", () => {
    expect(scopeLabel({ serviceId: null, categoryId: "classic" }, groups)).toBe("Classic");
    expect(scopeLabel({ serviceId: "s1", categoryId: null }, groups)).toBe("Classic Full Set");
    expect(scopeLabel(NO_SCOPE, groups)).toBeNull();
  });
});
