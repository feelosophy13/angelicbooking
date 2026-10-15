import type { TenantWithBill } from "./tenants";
import type { Tone } from "@/ui/kit";

export type Attention = { tenant: TenantWithBill; reason: string; tone: Tone; severity: number };

const DAY = 86_400_000;
const days = (ms: number) => Math.max(0, Math.floor(ms / DAY));

/** The businesses that need a human: failing payments first, then trials, then the ones who never started or went quiet. */
export function needsAttention(tenants: TenantWithBill[], now = Date.now()): Attention[] {
  const out: Attention[] = [];
  for (const t of tenants) {
    const age = now - t.createdAt.getTime();
    if (t.suspendedAt) {
      out.push({ tenant: t, reason: `Suspended${t.suspendedReason ? `: ${t.suspendedReason}` : ""}`, tone: "neutral", severity: 6 });
      continue;
    }
    if (t.subscriptionStatus === "past_due" || t.subscriptionStatus === "unpaid") {
      out.push({ tenant: t, reason: "Payment is failing", tone: "bad", severity: 1 });
      continue;
    }
    const trial = t.trialEndsAt?.getTime();
    if (!t.comped && trial && (t.subscriptionStatus === "none" || t.subscriptionStatus === "trialing")) {
      if (trial < now) { out.push({ tenant: t, reason: `Trial ended ${days(now - trial)} day${days(now - trial) === 1 ? "" : "s"} ago, no subscription`, tone: "warn", severity: 2 }); continue; }
      if (trial - now <= 7 * DAY) { out.push({ tenant: t, reason: `Trial ends in ${Math.max(1, days(trial - now))} day${days(trial - now) <= 1 ? "" : "s"}`, tone: "info", severity: 3 }); continue; }
    }
    if (t.customDomain && t.customDomainStatus === "manual") {
      out.push({ tenant: t, reason: `Wants ${t.customDomain}: add it to the hosting service by hand`, tone: "warn", severity: 4 });
      continue;
    }
    if (t.customDomain && t.customDomainStatus === "problem") {
      out.push({ tenant: t, reason: `Custom address ${t.customDomain} has a problem`, tone: "warn", severity: 4 });
      continue;
    }
    if (!t.onboarded && age > 3 * DAY) {
      out.push({ tenant: t, reason: `Signed up ${days(age)} days ago and never finished setting up`, tone: "warn", severity: 4 });
      continue;
    }
    if (t.appointments > 0 && t.appointments30d === 0 && age > 30 * DAY) {
      out.push({ tenant: t, reason: "Took bookings before, none in the last 30 days", tone: "neutral", severity: 5 });
    }
  }
  return out.sort((a, b) => a.severity - b.severity || b.tenant.createdAt.getTime() - a.tenant.createdAt.getTime());
}
