// Writes public/openapi/v1.json from the /api/v1 route files. Run after changing a route: `pnpm openapi`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildOpenApi, OPENAPI_PATH } from "../src/lib/openapi";

const root = join(import.meta.dirname, "..");
const spec = buildOpenApi(join(root, "src/app/api/v1"));
const out = join(root, OPENAPI_PATH);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");
console.log(`wrote ${OPENAPI_PATH}: ${Object.keys(spec.paths).length} paths`);
