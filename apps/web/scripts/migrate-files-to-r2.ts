/**
 * Move stored pictures and client files from Postgres to Cloudflare R2 (see server/files-to-r2.ts).
 * Usage (from apps/web, against whatever DATABASE_URL points at; R2_* must be set):
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/migrate-files-to-r2.ts [--dry-run]
 */
import { filesLeftInDatabase, migrateFilesToR2 } from "../src/server/files-to-r2";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const start = await filesLeftInDatabase();
  console.log(`In the database: ${start.files} files, ${mb(start.bytes)}`);
  if (process.argv.includes("--dry-run")) process.exit(0);
  let moved = 0;
  let before = 0;
  let after = 0;
  for (;;) {
    const r = await migrateFilesToR2(25);
    moved += r.moved;
    before += r.bytesBefore;
    after += r.bytesAfter;
    console.log(`  moved ${moved} (${mb(before)} -> ${mb(after)}), ${r.left.files} left${r.failed ? `, ${r.failed} failed this round` : ""}`);
    if (r.moved === 0 || r.left.files === 0) break;
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
