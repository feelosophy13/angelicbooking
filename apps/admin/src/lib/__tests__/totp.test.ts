import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, newSecret, totp, verifyTotp } from "../totp";

// RFC 6238 appendix B: ASCII secret "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("matches the RFC 6238 test vectors", () => {
    expect(totp(RFC_SECRET, 59_000, 8)).toBe("94287082");
    expect(totp(RFC_SECRET, 1111111109_000, 8)).toBe("07081804");
    expect(totp(RFC_SECRET, 2000000000_000, 8)).toBe("69279037");
  });
  it("round-trips base32", () => {
    const s = newSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(s).toHaveLength(32);
  });
  it("accepts a code once, tolerates one step of drift, rejects junk", () => {
    const t = 1_700_000_000_000;
    const code = totp(RFC_SECRET, t);
    expect(verifyTotp(RFC_SECRET, code, t)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, t)).toBe(false); // replay
    const later = t + 10 * 60_000;
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, later - 30_000), later)).toBe(true);
    expect(verifyTotp(RFC_SECRET, "12345", later)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", later)).toBe(false);
  });
});
