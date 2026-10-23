import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";

/** Who a cash tip can be paid out to: the active team. */
export async function tipStaff(businessId: string) {
  return withTenant(businessId, (tx) => tx.select({ id: schema.staff.id, name: schema.staff.displayName }).from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.displayName)));
}

/** The location a one-site-at-a-time page shows: the one asked for, else the main site. */
export function pickLocation<L extends { id: string; isDefault: boolean }>(locations: L[], asked: string | undefined): L | null {
  return locations.find((l) => l.id === asked) ?? locations.find((l) => l.isDefault) ?? locations[0] ?? null;
}
