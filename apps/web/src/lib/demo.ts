/** Demo businesses (built by scripts/seed-demo.ts) use slugs that start with "demo-". Nothing is ever sent to their fake clients. */
export const isDemoSlug = (slug: string | null | undefined): boolean => /^demo-/.test(slug ?? "");

/**
 * Whether a text number can carry this business's texts. A real business needs a carrier-verified number. A demo
 * business never sends (the queue skips its texts), so any number it holds is enough for the desk to use the Inbox.
 */
export const numberUsableFor = (slug: string | null | undefined, status: string): boolean => status === "verified" || (isDemoSlug(slug) && status !== "released");
