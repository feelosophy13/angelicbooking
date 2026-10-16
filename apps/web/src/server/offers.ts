import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { addMembershipPeriod, isMembershipInterval, periodNoun, renewedCredits } from "@angelic/core";
import { SaleError } from "./sales";
import { validAtLocation } from "./locations";

/** Gift cards, packages and memberships: catalog, selling at checkout, redemption. */

export function newGiftCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  const s = [...b].map((x) => alphabet[x % alphabet.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export async function getOffersCatalog(businessId: string) {
  return withTenant(businessId, async (tx) => {
    const [packs, plans, services, cards] = await Promise.all([
      tx.select().from(schema.packages).orderBy(desc(schema.packages.active), asc(schema.packages.name)),
      tx.select().from(schema.membershipPlans).orderBy(desc(schema.membershipPlans.active), asc(schema.membershipPlans.name)),
      tx.select({ id: schema.services.id, name: schema.services.name, priceCents: schema.services.priceCents }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)),
      tx.select().from(schema.giftCards).orderBy(desc(schema.giftCards.createdAt)).limit(50),
    ]);
    return { packages: packs, plans, services, giftCards: cards };
  });
}

/** Lazy state changes a membership makes on its own: a freeze that has ended resumes, a fixed-length plan whose last period passed ends. */
export async function settleMemberships(tx: TenantDb, clientId: string) {
  const now = new Date();
  const rows = await tx
    .select({ m: schema.clientMemberships, cycleCount: schema.membershipPlans.cycleCount })
    .from(schema.clientMemberships)
    .innerJoin(schema.membershipPlans, eq(schema.membershipPlans.id, schema.clientMemberships.planId))
    .where(and(eq(schema.clientMemberships.clientId, clientId), sql`${schema.clientMemberships.status} in ('active','paused')`));
  for (const { m, cycleCount } of rows) {
    if (m.status === "paused" && m.frozenUntil && m.frozenUntil <= now) {
      // Members without card billing get the frozen time back; Stripe-billed ones follow the next invoice.
      const extend = !m.stripeSubscriptionId && m.frozenAt ? Math.max(0, m.frozenUntil.getTime() - m.frozenAt.getTime()) : 0;
      await tx.update(schema.clientMemberships).set({ status: "active", frozenAt: null, frozenUntil: null, currentPeriodEnd: new Date(m.currentPeriodEnd.getTime() + extend) }).where(eq(schema.clientMemberships.id, m.id));
    } else if (m.status === "active" && cycleCount && m.cyclesBilled >= cycleCount && m.currentPeriodEnd <= now) {
      await tx.update(schema.clientMemberships).set({ status: "ended", autoRenew: false }).where(eq(schema.clientMemberships.id, m.id));
    }
  }
}

/** Client's usable credits for checkout. */
export async function getClientCredits(tx: TenantDb, clientId: string) {
  await settleMemberships(tx, clientId);
  const now = new Date();
  const [packs, memberships] = await Promise.all([
    tx
      .select({ id: schema.clientPackages.id, serviceId: schema.clientPackages.serviceId, remaining: schema.clientPackages.remaining, name: schema.packages.name, expiresAt: schema.clientPackages.expiresAt, validLocationIds: schema.packages.validLocationIds })
      .from(schema.clientPackages)
      .innerJoin(schema.packages, eq(schema.packages.id, schema.clientPackages.packageId))
      .where(and(eq(schema.clientPackages.clientId, clientId), gt(schema.clientPackages.remaining, 0), or(isNull(schema.clientPackages.expiresAt), gt(schema.clientPackages.expiresAt, now)))),
    tx
      .select({ id: schema.clientMemberships.id, planName: schema.membershipPlans.name, includedServiceId: schema.membershipPlans.includedServiceId, discountBps: schema.membershipPlans.discountBps, creditsRemaining: schema.clientMemberships.creditsRemaining, currentPeriodEnd: schema.clientMemberships.currentPeriodEnd, status: schema.clientMemberships.status, validLocationIds: schema.membershipPlans.validLocationIds })
      .from(schema.clientMemberships)
      .innerJoin(schema.membershipPlans, eq(schema.membershipPlans.id, schema.clientMemberships.planId))
      .where(and(eq(schema.clientMemberships.clientId, clientId), eq(schema.clientMemberships.status, "active"), gt(schema.clientMemberships.currentPeriodEnd, now))),
  ]);
  return { packages: packs, memberships };
}

/** Add a gift card / package / membership line to an open sale. Fulfilment happens when the sale is paid. */
export async function addOfferLine(input: { businessId: string; saleId: string; kind: "gift_card" | "package" | "membership"; refId: string | null; amountCents: number | null; recipientName?: string | null; /** Who sold it, for commission (packages). */ staffId?: string | null }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale || sale.status !== "open") throw new SaleError("Sale is not open.");
    let name = "";
    let amount = 0;
    if (input.kind === "gift_card") {
      if (!input.amountCents || input.amountCents < 100) throw new SaleError("Gift card amount must be at least $1.");
      amount = input.amountCents;
      name = `Gift card${input.recipientName ? ` for ${input.recipientName}` : ""}`;
    } else if (input.kind === "package") {
      const p = await tx.query.packages.findFirst({ where: eq(schema.packages.id, input.refId ?? "") });
      if (!p || !p.active) throw new SaleError("Package not found.");
      amount = p.priceCents;
      name = `${p.name} (${p.sessions} sessions)`;
    } else {
      const p = await tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, input.refId ?? "") });
      if (!p || !p.active) throw new SaleError("Membership plan not found.");
      if (!sale.clientId) throw new SaleError("Attach a client to sell a membership.");
      amount = p.priceCents;
      const noun = periodNoun(isMembershipInterval(p.interval) ? p.interval : "month", p.intervalCount);
      name = `${p.name} membership (${p.intervalCount > 1 ? noun : `1 ${noun}`})`;
    }
    await tx.insert(schema.saleLines).values({ businessId: input.businessId, saleId: sale.id, kind: input.kind, productId: input.refId, staffId: input.staffId ?? null, name, quantity: 1, unitCents: amount, amountCents: amount, taxable: false, sortOrder: 200 });
    await tx.update(schema.sales).set({ subtotalCents: sql`${schema.sales.subtotalCents} + ${amount}`, totalCents: sql`${schema.sales.totalCents} + ${amount}` }).where(eq(schema.sales.id, sale.id));
  });
}

/** Called once when a sale becomes paid: issue cards, credits and memberships. Idempotent via sale_id. */
export async function fulfilOfferLines(tx: TenantDb, businessId: string, saleId: string) {
  const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, saleId) });
  if (!sale) return;
  const lines = await tx.select().from(schema.saleLines).where(and(eq(schema.saleLines.saleId, saleId), sql`${schema.saleLines.kind} in ('gift_card','package','membership')`));
  for (const l of lines) {
    if (l.kind === "gift_card") {
      // Idempotent per line, not per amount: two $50 cards on one ticket are two cards.
      const wanted = lines.filter((x) => x.kind === "gift_card" && x.amountCents === l.amountCents).length;
      const [have] = await tx.select({ n: sql<number>`count(*)` }).from(schema.giftCards).where(and(eq(schema.giftCards.saleId, saleId), eq(schema.giftCards.initialCents, l.amountCents)));
      if (Number(have?.n ?? 0) >= wanted) continue;
      await tx.insert(schema.giftCards).values({ businessId, code: newGiftCode(), initialCents: l.amountCents, balanceCents: l.amountCents, purchaserClientId: sale.clientId, recipientName: l.name.replace(/^Gift card( for )?/, "") || null, saleId, locationId: sale.locationId });
    } else if (l.kind === "package" && l.productId && sale.clientId) {
      const wanted = lines.filter((x) => x.kind === "package" && x.productId === l.productId).length;
      const [have] = await tx.select({ n: sql<number>`count(*)` }).from(schema.clientPackages).where(and(eq(schema.clientPackages.saleId, saleId), eq(schema.clientPackages.packageId, l.productId)));
      if (Number(have?.n ?? 0) >= wanted) continue;
      const p = await tx.query.packages.findFirst({ where: eq(schema.packages.id, l.productId) });
      if (!p) continue;
      await tx.insert(schema.clientPackages).values({ businessId, clientId: sale.clientId, packageId: p.id, serviceId: p.serviceId, remaining: p.sessions, saleId, locationId: sale.locationId, expiresAt: p.validDays ? new Date(Date.now() + p.validDays * 86_400_000) : null });
    } else if (l.kind === "membership" && l.productId && sale.clientId) {
      const plan = await tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, l.productId) });
      if (!plan) continue;
      const interval = isMembershipInterval(plan.interval) ? plan.interval : "month";
      // Selling the plan again renews by hand (and revives one paused by a failed card or a freeze) instead of starting a duplicate.
      const existing = await tx.query.clientMemberships.findFirst({ where: and(eq(schema.clientMemberships.clientId, sale.clientId), eq(schema.clientMemberships.planId, plan.id), sql`${schema.clientMemberships.status} in ('active','paused')`) });
      if (existing) {
        // Next period starts when the current one ends (or now, if lapsed).
        const lapsed = existing.currentPeriodEnd <= new Date();
        const base = lapsed ? new Date() : existing.currentPeriodEnd;
        const credits = lapsed ? plan.includedSessions : renewedCredits(existing.creditsRemaining, plan.includedSessions, plan.rolloverCap);
        await tx.update(schema.clientMemberships).set({ currentPeriodEnd: addMembershipPeriod(base, interval, plan.intervalCount), creditsRemaining: credits, cyclesBilled: existing.cyclesBilled + 1, status: "active", paymentFailedAt: null, frozenAt: null, frozenUntil: null }).where(eq(schema.clientMemberships.id, existing.id));
      } else {
        await tx.insert(schema.clientMemberships).values({ businessId, clientId: sale.clientId, planId: plan.id, currentPeriodEnd: addMembershipPeriod(new Date(), interval, plan.intervalCount), creditsRemaining: plan.includedSessions, cyclesBilled: 1, locationId: sale.locationId });
      }
    }
  }
}

/** Pay (part of) a sale with a gift card. */
export async function redeemGiftCard(input: { businessId: string; saleId: string; code: string; amountCents: number; actorUserId: string }) {
  return withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale || sale.status !== "open") throw new SaleError("Sale is not open.");
    const code = input.code.trim().toUpperCase();
    const card = await tx.query.giftCards.findFirst({ where: and(eq(schema.giftCards.code, code), eq(schema.giftCards.active, true)) });
    if (!card) throw new SaleError("Gift card not found.");
    if (card.expiresAt && card.expiresAt < new Date()) throw new SaleError("Gift card has expired.");
    if (!validAtLocation(card.validLocationIds, sale.locationId)) throw new SaleError("This gift card isn't valid at this location.");
    const due = sale.totalCents - sale.paidCents;
    const amount = Math.min(input.amountCents, card.balanceCents, due);
    if (amount <= 0) throw new SaleError(card.balanceCents === 0 ? "That gift card has no balance left." : "Nothing to redeem.");
    // Atomic: two desks redeeming the same card at once can't both spend the same balance.
    const spent = await tx
      .update(schema.giftCards)
      .set({ balanceCents: sql`${schema.giftCards.balanceCents} - ${amount}` })
      .where(and(eq(schema.giftCards.id, card.id), sql`${schema.giftCards.balanceCents} >= ${amount}`))
      .returning({ id: schema.giftCards.id });
    if (!spent.length) throw new SaleError("That gift card no longer has enough balance.");
    await tx.insert(schema.payments).values({ businessId: input.businessId, saleId: sale.id, method: "gift_card", status: "succeeded", amountCents: amount, tipCents: 0, note: `Gift card ${code}`, giftCardId: card.id, createdByUserId: input.actorUserId });
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "payment.gift_card", entity: "sale", entityId: sale.id, diff: JSON.stringify({ code, amount }) });
    return amount;
  });
}

/** Cover a service line with a package session or membership credit (line becomes $0). */
export async function redeemCredit(input: { businessId: string; saleId: string; lineId: string; source: "package" | "membership"; sourceId: string; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale || sale.status !== "open") throw new SaleError("Sale is not open.");
    const line = await tx.query.saleLines.findFirst({ where: and(eq(schema.saleLines.id, input.lineId), eq(schema.saleLines.saleId, sale.id)) });
    if (!line || line.kind !== "service" || line.amountCents === 0) throw new SaleError("Pick a service line that hasn't been covered yet.");
    if (input.source === "package") {
      const cp = await tx.query.clientPackages.findFirst({ where: and(eq(schema.clientPackages.id, input.sourceId), eq(schema.clientPackages.clientId, sale.clientId ?? "")) });
      if (!cp || cp.remaining <= 0) throw new SaleError("No sessions left on that package.");
      if (cp.expiresAt && cp.expiresAt < new Date()) throw new SaleError("That package has expired.");
      if (cp.serviceId && line.serviceId && cp.serviceId !== line.serviceId) throw new SaleError("That package is for a different service.");
      const pkg = await tx.query.packages.findFirst({ where: eq(schema.packages.id, cp.packageId), columns: { validLocationIds: true } });
      if (!validAtLocation(pkg?.validLocationIds, sale.locationId)) throw new SaleError("That package isn't valid at this location.");
      await tx.update(schema.clientPackages).set({ remaining: cp.remaining - 1 }).where(eq(schema.clientPackages.id, cp.id));
    } else {
      const m = await tx.query.clientMemberships.findFirst({ where: and(eq(schema.clientMemberships.id, input.sourceId), eq(schema.clientMemberships.clientId, sale.clientId ?? ""), eq(schema.clientMemberships.status, "active")) });
      if (!m || m.creditsRemaining <= 0) throw new SaleError("No membership credits left this period.");
      if (m.currentPeriodEnd < new Date()) throw new SaleError("That membership's current period has ended.");
      const plan = await tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, m.planId), columns: { validLocationIds: true } });
      if (!validAtLocation(plan?.validLocationIds, sale.locationId)) throw new SaleError("That membership isn't valid at this location.");
      await tx.update(schema.clientMemberships).set({ creditsRemaining: m.creditsRemaining - 1 }).where(eq(schema.clientMemberships.id, m.id));
    }
    const delta = line.amountCents;
    await tx
      .update(schema.saleLines)
      .set({ amountCents: 0, unitCents: 0, name: `${line.name} (${input.source} credit)`, creditCents: delta, ...(input.source === "package" ? { clientPackageId: input.sourceId } : { clientMembershipId: input.sourceId }) })
      .where(eq(schema.saleLines.id, line.id));
    await tx.update(schema.sales).set({ subtotalCents: sql`${schema.sales.subtotalCents} - ${delta}`, totalCents: sql`${schema.sales.totalCents} - ${delta}` }).where(eq(schema.sales.id, sale.id));
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: `credit.${input.source}`, entity: "sale", entityId: sale.id, diff: JSON.stringify({ lineId: line.id, delta }) });
  });
}

/** Give back the package session or membership credit a sale line was covered with (line removed or sale voided). */
export async function restoreCreditForLine(tx: TenantDb, line: typeof schema.saleLines.$inferSelect) {
  if (line.creditCents <= 0) return;
  if (line.clientPackageId) {
    await tx.update(schema.clientPackages).set({ remaining: sql`${schema.clientPackages.remaining} + 1` }).where(eq(schema.clientPackages.id, line.clientPackageId));
  } else if (line.clientMembershipId) {
    await tx.update(schema.clientMemberships).set({ creditsRemaining: sql`${schema.clientMemberships.creditsRemaining} + 1` }).where(eq(schema.clientMemberships.id, line.clientMembershipId));
  }
}

export async function issueGiftCardManually(input: { businessId: string; amountCents: number; recipientName: string | null; actorUserId: string; validLocationIds?: string[] }) {
  return withTenant(input.businessId, async (tx) => {
    const [row] = await tx.insert(schema.giftCards).values({ businessId: input.businessId, code: newGiftCode(), initialCents: input.amountCents, balanceCents: input.amountCents, recipientName: input.recipientName, validLocationIds: input.validLocationIds ?? [] }).returning();
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "gift_card.issue", entity: "gift_card", entityId: row!.id, diff: JSON.stringify({ amount: input.amountCents }) });
    return row!;
  });
}
