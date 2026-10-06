// Load the repo-root .env regardless of the current working directory so that
// drizzle-kit, the migrator and tests all see the same DATABASE_URL.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../.env") });
