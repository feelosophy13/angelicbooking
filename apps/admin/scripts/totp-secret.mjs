// Usage: pnpm --filter @angelic/admin totp-secret
// Prints a new ADMIN_TOTP_SECRET and the otpauth:// link to add it to an authenticator app
// (Google Authenticator, 1Password, Authy: "enter a setup key" or paste the link into a QR generator you trust).
import { randomBytes } from "node:crypto";

const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
let bits = 0, value = 0, secret = "";
for (const b of randomBytes(20)) {
  value = (value << 8) | b;
  bits += 8;
  while (bits >= 5) { secret += A[(value >>> (bits - 5)) & 31]; bits -= 5; }
}
console.log(`ADMIN_TOTP_SECRET=${secret}`);
console.log(`otpauth://totp/Angelic%20admin?secret=${secret}&issuer=Angelic%20Booking`);
