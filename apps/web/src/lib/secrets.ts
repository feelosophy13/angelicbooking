import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption for third-party secrets kept in the database (a merchant's Helcim API token, webhook verifier, a pending checkout's
 * secret): AES-256-GCM with APP_ENCRYPTION_KEY (32 bytes, base64). Development falls back to a key derived from BETTER_AUTH_SECRET;
 * production refuses to run without the real key, so rotating the auth secret can never lock merchants out of their tokens.
 */
function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
    return k;
  }
  if (process.env.NODE_ENV === "production") throw new Error("APP_ENCRYPTION_KEY is not set.");
  return createHash("sha256").update(`dev-only:${process.env.BETTER_AUTH_SECRET ?? "angelic"}`).digest();
}

/** "v1.<iv>.<tag>.<ciphertext>", all base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptSecret(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) throw new Error("Unreadable secret.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}
