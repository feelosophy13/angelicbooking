// Dev check: run an import file through the same code the UI uses.
// Usage: tsx --tsconfig tsconfig.json scripts/import-check.mts <slug> <kind> <file>
import "../../../packages/db/src/env";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { parseTable } from "../src/lib/import/parse";
import { autoMap, type ImportKind } from "../src/lib/import/mapping";
import { runImport } from "../src/server/import";

const [slug, kind, file] = process.argv.slice(2);
const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug!) });
if (!business) throw new Error("no business");
const bytes = readFileSync(file!);
const table = await parseTable({ name: file!, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
const mapping = autoMap(kind as ImportKind, table.headers);
console.log("headers:", table.headers.join(" | "));
console.log("mapping:", JSON.stringify(mapping));
const r = await runImport(business, kind as ImportKind, table.rows, mapping, null, file!.split("/").pop()!);
console.log("result:", JSON.stringify(r));
process.exit(0);
