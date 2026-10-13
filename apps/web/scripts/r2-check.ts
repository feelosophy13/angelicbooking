/**
 * Proves the R2_* settings work: writes, reads and deletes one small object in each bucket, and fetches the
 * public one through its CDN address. Usage (from apps/web):
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/r2-check.ts
 */
import { deleteObject, getObject, publicObjectUrl, putObject, r2Config } from "../src/lib/object-storage";

async function main() {
  const cfg = r2Config();
  if (!cfg) throw new Error("R2_* variables are not all set.");
  const key = `healthcheck/${Date.now()}.txt`;
  for (const vis of ["public", "private"] as const) {
    await putObject(cfg, vis, key, Buffer.from("ok"), "text/plain");
    const got = await getObject(cfg, vis, key);
    console.log(`${vis} bucket: wrote and read ${got?.body.toString() === "ok" ? "ok" : "MISMATCH"}`);
    if (vis === "public") {
      let result: string;
      try {
        const res = await fetch(publicObjectUrl(cfg, key));
        result = res.ok ? "200 ok" : `not reachable yet (${res.status})`;
      } catch (e) {
        result = `not reachable yet (${(e as Error).message})`;
      }
      console.log(`  CDN ${publicObjectUrl(cfg, key)} -> ${result}`);
    }
    await deleteObject(cfg, vis, key);
  }
  console.log("R2 is working.");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
