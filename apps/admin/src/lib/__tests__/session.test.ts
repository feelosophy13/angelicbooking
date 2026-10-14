import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkPassword, recordFailure, throttled, createToken, verifyToken } from "../session";

const KEY = "k".repeat(40);

describe("admin session token", () => {
  it("accepts a fresh token and rejects tampering, expiry and junk", () => {
    const now = 1_000_000;
    const t = createToken(now, KEY);
    expect(verifyToken(t, now + 1000, KEY)).toBe(true);
    expect(verifyToken(t, now + 9 * 3600_000, KEY)).toBe(false);
    expect(verifyToken(t, now, "x".repeat(40))).toBe(false);
    const [p, m] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ exp: now + 99 * 3600_000 })).toString("base64url");
    expect(verifyToken(`${forged}.${m}`, now, KEY)).toBe(false);
    expect(verifyToken(`${p}.${m}.x`, now, KEY)).toBe(false);
    expect(verifyToken(undefined, now, KEY)).toBe(false);
    expect(verifyToken("garbage", now, KEY)).toBe(false);
  });
});

describe("admin password", () => {
  const salt = randomBytes(16);
  const hash = `scrypt:${salt.toString("hex")}:${scryptSync("correct horse battery", salt, 64).toString("hex")}`;
  it("checks scrypt hashes", () => {
    expect(checkPassword("correct horse battery", hash)).toBe(true);
    expect(checkPassword("wrong", hash)).toBe(false);
    expect(checkPassword("anything", undefined)).toBe(false);
    expect(checkPassword("anything", "plaintext")).toBe(false);
  });
});

describe("login throttle", () => {
  it("blocks after five failures and recovers after the window", () => {
    const now = 5_000_000;
    for (let i = 0; i < 5; i++) recordFailure("1.2.3.4", now);
    expect(throttled("1.2.3.4", now)).toBe(true);
    expect(throttled("1.2.3.4", now + 16 * 60_000)).toBe(false);
    expect(throttled("9.9.9.9", now)).toBe(false);
  });
});
