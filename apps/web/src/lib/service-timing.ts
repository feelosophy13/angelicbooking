/** Say what a service's four times do to a stylist's calendar, in words (the booking rules live in @angelic/core's buildBookingSegments). */
export const wholeMinutes = (v: string) => Math.max(0, Math.round(Number(v) || 0));
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

export function describeTiming(t: { duration: number; gap: number; finish: number; buffer: number }): { tone: "ok" | "warn"; text: string } {
  const { duration: D, gap: G, finish: F, buffer: B } = t;
  const total = D + G + F + B;
  // A wait only frees the stylist when something follows it; with no finishing block it is simply more booked time.
  if (G > 0 && F > 0) return { tone: "ok", text: `Busy for the first ${hm(D)}, free for ${hm(G)} to take someone else, then busy again for ${hm(F + B)}${B ? ` (${hm(F)} of work, ${hm(B)} clean-up)` : ""}. The client is there ${hm(total)} in all.` };
  if (G > 0) return { tone: "warn", text: `The ${hm(G)} wait will NOT free you up: with no "then finish" time, you stay booked for all ${hm(total)}. Add a finish time to let someone else be booked during the wait.` };
  return { tone: "ok", text: `Booked solid for ${hm(total)}${B ? `, including ${hm(B)} of clean-up` : ""}.` };
}
