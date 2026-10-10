import { beforeAll, describe, expect, it } from "vitest";
import { decodeClientSession, encodeClientSession } from "../client-session";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-client-sessions";
});

describe("client session cookie", () => {
  it("round-trips a client id for its business", () => {
    const v = encodeClientSession("biz_1", "client_9");
    expect(decodeClientSession(v, "biz_1")).toBe("client_9");
  });
  it("rejects another business, tampering and expiry", () => {
    const v = encodeClientSession("biz_1", "client_9", Date.now() - 40 * 86_400_000);
    expect(decodeClientSession(encodeClientSession("biz_1", "client_9"), "biz_2")).toBeNull();
    expect(decodeClientSession(encodeClientSession("biz_1", "client_9") + "x", "biz_1")).toBeNull();
    expect(decodeClientSession(v, "biz_1")).toBeNull();
    expect(decodeClientSession(undefined, "biz_1")).toBeNull();
  });
});
