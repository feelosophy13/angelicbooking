/** Demo businesses (built by scripts/seed-demo.ts) use slugs that start with "demo-". Nothing is ever sent to their fake clients. */
export const isDemoSlug = (slug: string | null | undefined): boolean => /^demo-/.test(slug ?? "");
