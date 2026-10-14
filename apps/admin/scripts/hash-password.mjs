// Usage: pnpm --filter @angelic/admin hash-password 'the password'
// Prints the value for ADMIN_PASSWORD_HASH.
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error("Pass a password of at least 12 characters as the first argument.");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
console.log(`scrypt:${salt.toString("hex")}:${hash.toString("hex")}`);
