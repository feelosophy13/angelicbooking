// Create (or reset the password of) a platform admin account. The first admin has to be made this way; after that, admins can be added from the app (Admins).
//   pnpm --filter @angelic/admin create-admin you@example.com ["Your Name"]
// Reads ADMIN_DATABASE_URL from the environment (run it with --env-file for local dev, or with the production URL from Render's shell).
// The password is typed at a hidden prompt; for scripts it can be passed in ADMIN_NEW_PASSWORD instead. At least 12 characters.
import { randomBytes, scryptSync } from "node:crypto";
import postgres from "postgres";

const email = (process.argv[2] ?? "").trim().toLowerCase();
const name = process.argv[3]?.trim() || null;
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: create-admin you@example.com ["Your Name"]');
  process.exit(1);
}
const url = process.env.ADMIN_DATABASE_URL;
if (!url) {
  console.error("ADMIN_DATABASE_URL is not set.");
  process.exit(1);
}

async function ask(prompt) {
  if (process.env.ADMIN_NEW_PASSWORD) return process.env.ADMIN_NEW_PASSWORD;
  if (!process.stdin.isTTY) throw new Error("No terminal to ask for a password on; set ADMIN_NEW_PASSWORD.");
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let text = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\u0003") process.exit(130);
        if (c === "\r" || c === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(text);
        }
        if (c === "\u007f") text = text.slice(0, -1);
        else text += c;
      }
    };
    process.stdin.on("data", onData);
  });
}

const password = await ask("Password (hidden, 12+ characters): ");
if (password.length < 12) {
  console.error("Use at least 12 characters.");
  process.exit(1);
}
if (!process.env.ADMIN_NEW_PASSWORD && (await ask("Again: ")) !== password) {
  console.error("The two passwords don't match.");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = `scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;

const sql = postgres(url, { max: 1, prepare: false });
try {
  const [row] = await sql`
    insert into admin_users (email, name, password_hash) values (${email}, ${name}, ${hash})
    on conflict (lower(email)) do update set password_hash = excluded.password_hash, name = coalesce(excluded.name, admin_users.name), disabled_at = null, updated_at = now()
    returning id`;
  await sql`insert into admin_audit_log (actor, action, detail) values ('create-admin script', 'admin.password.reset', ${sql.json({ email })})`;
  console.log(`Admin ${email} is ready (${row.id}).`);
} finally {
  await sql.end();
}
