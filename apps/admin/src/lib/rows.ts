/**
 * drizzle's postgres-js driver turns off the driver's timestamp parsing (it maps them itself for typed queries), so
 * rows from a raw `db.execute(sql...)` carry timestamps as strings. Call this on every raw result so the rest of the
 * app can rely on Date objects.
 */
export function revive<T>(rows: unknown, dateKeys: readonly string[]): T[] {
  return (rows as Record<string, unknown>[]).map((r) => {
    const out = { ...r };
    for (const k of dateKeys) {
      const v = out[k];
      out[k] = v == null ? null : v instanceof Date ? v : new Date(v as string);
    }
    return out as T;
  });
}
