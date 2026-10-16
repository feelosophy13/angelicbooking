import { describe, expect, it } from "vitest";
import { acceptedEmail, decodeIdToken, googleEnabled, pkcePair } from "../google";
import { createResetToken, fingerprint, mayRequestReset, noteResetRequest, peekEmail, verifyResetToken } from "../reset-token";
import { checkPassword, hashPassword, sessionCookieOptions } from "../session";

const SECRET = "s".repeat(40);
const HASH = "scrypt:aa:bb";
const now = 1_800_000_000_000;

describe("password reset links", () => {
  it("accepts a fresh link for the right password and rejects everything else", () => {
    const t = createResetToken(SECRET, "me@x.com", HASH, now);
    expect(verifyResetToken(SECRET, t, HASH, now + 60_000)).toEqual({ email: "me@x.com" });
    expect(verifyResetToken(SECRET, t, HASH, now + 31 * 60_000)).toBeNull(); // expired
    expect(verifyResetToken(SECRET, t, "scrypt:cc:dd", now + 60_000)).toBeNull(); // password already changed: single use
    expect(verifyResetToken("x".repeat(40), t, HASH, now + 60_000)).toBeNull(); // wrong secret
    const [p, m] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ e: "evil@x.com", x: now + 9e9, f: fingerprint(HASH) })).toString("base64url");
    expect(verifyResetToken(SECRET, `${forged}.${m}`, HASH, now)).toBeNull();
    expect(verifyResetToken(SECRET, `${p}.${m}.z`, HASH, now)).toBeNull();
    expect(verifyResetToken(SECRET, undefined, HASH, now)).toBeNull();
    expect(verifyResetToken(SECRET, "junk", HASH, now)).toBeNull();
  });
  it("names the email in a link (unverified) so the right account's hash can be fetched, and a link for a new admin works with no password yet", () => {
    const t = createResetToken(SECRET, "new@x.com", "", now);
    expect(peekEmail(t)).toBe("new@x.com");
    expect(peekEmail("junk")).toBeNull();
    expect(peekEmail(undefined)).toBeNull();
    expect(verifyResetToken(SECRET, t, "", now + 60_000)).toEqual({ email: "new@x.com" });
    expect(verifyResetToken(SECRET, t, "scrypt:aa:bb", now + 60_000)).toBeNull(); // single use: once a password is set the link is dead
  });
  it("limits how often a link can be requested", () => {
    const ip = "9.9.9.9";
    const t0 = Date.now() + 10 * 3_600_000;
    expect(mayRequestReset(ip, t0)).toBe(true);
    noteResetRequest(ip, t0);
    expect(mayRequestReset(ip, t0 + 5_000)).toBe(false); // one a minute
    expect(mayRequestReset(ip, t0 + 61_000)).toBe(true);
    noteResetRequest(ip, t0 + 61_000);
    noteResetRequest(ip, t0 + 130_000);
    expect(mayRequestReset(ip, t0 + 200_000)).toBe(false); // three an hour
    expect(mayRequestReset(ip, t0 + 3_700_000)).toBe(true);
  });
  it("hashes new passwords in the format the login understands", () => {
    const h = hashPassword("a long enough passphrase");
    expect(checkPassword("a long enough passphrase", h)).toBe(true);
    expect(checkPassword("something else entirely", h)).toBe(false);
  });
});

describe("google sign-in", () => {
  const claims = { iss: "https://accounts.google.com", aud: "cid", exp: now / 1000 + 600, email: "Owner@Gmail.com", email_verified: true };
  const opts = { clientId: "cid", allowed: ["owner@gmail.com"], now };
  it("accepts a verified, allowed, current token (case-insensitive email)", () => {
    expect(acceptedEmail(claims, opts)).toBe("owner@gmail.com");
  });
  it("rejects the wrong audience, issuer, expiry, unverified or unlisted email", () => {
    expect(acceptedEmail({ ...claims, aud: "other" }, opts)).toBeNull();
    expect(acceptedEmail({ ...claims, iss: "https://evil.com" }, opts)).toBeNull();
    expect(acceptedEmail({ ...claims, exp: now / 1000 - 1 }, opts)).toBeNull();
    expect(acceptedEmail({ ...claims, email_verified: false }, opts)).toBeNull();
    expect(acceptedEmail({ ...claims, email: "stranger@gmail.com" }, opts)).toBeNull();
    expect(acceptedEmail(null, opts)).toBeNull();
  });
  it("decodes a JWT payload and builds a PKCE pair", () => {
    const jwt = `h.${Buffer.from(JSON.stringify({ email: "a@b.c" })).toString("base64url")}.s`;
    expect(decodeIdToken(jwt)?.email).toBe("a@b.c");
    expect(decodeIdToken("nope")).toBeNull();
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).not.toBe(verifier);
  });
  it("needs both Google keys", () => {
    expect(googleEnabled({ GOOGLE_CLIENT_ID: "a" })).toBe(false);
    expect(googleEnabled({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toBe(true);
  });
});

describe("session cookie", () => {
  it("is Lax so it survives the redirect back from Google, and secure in production", () => {
    expect(sessionCookieOptions(true)).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    expect(sessionCookieOptions(false).secure).toBe(false);
  });
});
