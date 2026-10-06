import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url =
  process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? "postgres://localhost:5432/angelic_booking";
const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
console.log("migrations applied");
await sql.end();
