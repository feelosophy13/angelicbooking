import { timingSafeEqual } from "node:crypto";

/** Constant-time check of the job routes' "Bearer <JOBS_SECRET>" header. */
export function jobsAuthorized(header: string | null): boolean {
  const secret = process.env.JOBS_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
