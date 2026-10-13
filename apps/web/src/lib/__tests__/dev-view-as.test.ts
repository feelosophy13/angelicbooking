import { describe, expect, it } from "vitest";
import { viewAsEnabled } from "../dev-view-as";

describe("viewAsEnabled", () => {
  it("is on for local development", () => {
    expect(viewAsEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(viewAsEnabled({})).toBe(true);
  });
  it("is off in production and on hosting platforms", () => {
    expect(viewAsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(viewAsEnabled({ NODE_ENV: "development", RENDER: "true" })).toBe(false);
    expect(viewAsEnabled({ VERCEL: "1" })).toBe(false);
  });
});
