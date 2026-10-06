import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { SaleError } from "./sales";

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

/** Client's usable credits for checkout. */
export async function getClientCredits(tx: TenantDb, clientId: string) {
  const now = new Date();
  const [packs, memberships] = await Promise.all([
    tx
      .select({ id: schema.clientPackages.id, serviceId: schema.clientPackages.serviceId, remaining: schema.clientPackages.remaining, name: schema.packages.name, expiresAt: schema.clientPackages.expiresAt })
      .from(schema.clientPackages)
      .innerJoin(schema.packages, eq(schema.packages.id, schema.clientPackages.packageId))
      .where(and(eq(schema.clientPackages.clientId, clientId), gt(schema.clientPackages.remaining, 0), or(isNull(schema.clientPackages.expiresAt), gt(schema.clientPackages.expiresAt, now)))),
    tx
      .select({ id: schema.clientMemberships.id, planName: schema.membershipPlans.name, includedServiceId: schema.membershipPlans.includedServiceId, discountBps: schema.membershipPlans.discountBps, creditsRemaining: schema.clientMemberships.creditsRemaining, currentPeriodEnd: schema.clientMemberships.currentPeriodEnd, status: schema.clientMemberships.status })
      .from(schema.clientMemberships)
      .innerJoin(schema.membershipPlans, eq(schema.membershipPlans.id, schema.clientMemberships.planId))
      .where(and(eq(schema.clientMemberships.clientId, clientId), eq(schema.clientMemberships.status, "active"), gt(schema.clientMemberships.currentPeriodEnd, now))),
  ]);
  return { packages: packs, memberships };
}

/** Add a gift card / package / membership line to an open sale. Fulfilment happens when the sale is paid. */
export async function addOfferLine(input: { businessId: string; saleId: string; kind: "gift_card" | "package" | "membership"; refId: string | null; amountCents: number | null; recipientName?: string | null }) {
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
      name = `${p.name} membership (1 month)`;
    }
    await tx.insert(schema.saleLines).values({ businessId: input.businessId, saleId: sale.id, kind: input.kind, productId: input.refId, name, quantity: 1, unitCents: amount, amountCents: amount, taxable: false, sortOrder: 200 });
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
      const already = await tx.query.giftCards.findFirst({ where: and(eq(schema.giftCards.saleId, saleId), eq(schema.giftCards.initialCents, l.amountCents)) });
      if (already) continue;
      await tx.insert(schema.giftCards).values({ businessId, code: newGiftCode(), initialCents: l.amountCents, balanceCents: l.amountCents, purchaserClientId: sale.clientId, recipientName: l.name.replace(/^Gift card( for )?/, "") || null, saleId });
    } else if (l.kind === "package" && l.productId && sale.clientId) {
      const already = await tx.query.clientPackages.findFirst({ where: and(eq(schema.clientPackages.saleId, saleId), eq(schema.clientPackages.packageId, l.productId)) });
      if (already) continue;
      const p = await tx.query.packages.findFirst({ where: eq(schema.packages.id, l.productId) });
      if (!p) continue;
      await tx.insert(schema.clientPackages).values({ businessId, clientId: sale.clientId, packageId: p.id, serviceId: p.serviceId, remaining: p.sessions, saleId, expiresAt: p.validDays ? new Date(Date.now() + p.validDays * 86_400_000) : null });
    } else if (l.kind === "membership" && l.productId && sale.clientId) {
      const plan = await tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, l.productId) });
      if (!plan) continue;
      const existing = await tx.query.clientMemberships.findFirst({ where: and(eq(schema.clientMemberships.clientId, sale.clientId), eq(schema.clientMemberships.planId, plan.id), eq(schema.clientMemberships.status, "active")) });
      const month = 30 * 86_400_000;
      if (existing) {
        const base = existing.currentPeriodEnd > new Date() ? existing.currentPeriodEnd.getTime() : Date.now();
        await tx.update(schema.clientMemberships).set({ currentPeriodEnd: new Date(base + month), creditsRemaining: plan.includedSessions }).where(eq(schema.clientMemberships.id, existing.id));
      } else {
        await tx.insert(schema.clientMemberships).values({ businessId, clientId: sale.clientId, planId: plan.id, currentPeriodEnd: new Date(Date.now() + month), creditsRemaining: plan.includedSessions });
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
    const due = sale.totalCents - sale.paidCents;
    const amount = Math.min(input.amountCents, card.balanceCents, due);
    if (amount <= 0) throw new SaleError(card.balanceCents === 0 ? "That gift card has no balance left." : "Nothing to redeem.");
    await tx.update(schema.giftCards).set({ balanceCents: card.balanceCents - amount }).where(eq(schema.giftCards.id, card.id));
    await tx.insert(schema.payments).values({ businessId: input.businessId, saleId: sale.id, method: "gift_card", status: "succeeded", amountCents: amount, tipCents: 0, note: `Gift card ${code}`, createdByUserId: input.actorUserId });
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
      if (line.serviceId && cp.serviceId !== line.serviceId) throw new SaleError("That package is for a different service.");
      await tx.update(schema.clientPackages).set({ remaining: cp.remaining - 1 }).where(eq(schema.clientPackages.id, cp.id));
    } else {
      const m = await tx.query.clientMemberships.findFirst({ where: and(eq(schema.clientMemberships.id, input.sourceId), eq(schema.clientMemberships.clientId, sale.clientId ?? ""), eq(schema.clientMemberships.status, "active")) });
      if (!m || m.creditsRemaining <= 0) throw new SaleError("No membership credits left this period.");
      await tx.update(schema.clientMemberships).set({ creditsRemaining: m.creditsRemaining - 1 }).where(eq(schema.clientMemberships.id, m.id));
    }
    const delta = line.amountCents;
    await tx.update(schema.saleLines).set({ amountCents: 0, unitCents: 0, name: `${line.name} (${input.source} credit)` }).where(eq(schema.saleLines.id, line.id));
    await tx.update(schema.sales).set({ subtotalCents: sql`${schema.sales.subtotalCents} - ${delta}`, totalCents: sql`${schema.sales.totalCents} - ${delta}` }).where(eq(schema.sales.id, sale.id));
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: `credit.${input.source}`, entity: "sale", entityId: sale.id, diff: JSON.stringify({ lineId: line.id, delta }) });
  });
}

export async function issueGiftCardManually(input: { businessId: string; amountCents: number; recipientName: string | null; actorUserId: string }) {
  return withTenant(input.businessId, async (tx) => {
    const [row] = await tx.insert(schema.giftCards).values({ businessId: input.businessId, code: newGiftCode(), initialCents: input.amountCents, balanceCents: input.amountCents, recipientName: input.recipientName }).returning();
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "gift_card.issue", entity: "gift_card", entityId: row!.id, diff: JSON.stringify({ amount: input.amountCents }) });
    return row!;
  });
}
