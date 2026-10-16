/**
 * Smoke test of the card-on-file money paths against the demo Stripe sandbox (test mode, local database only): a no-show fee ticket on an
 * un-rung demo-salon appointment, two simultaneous charges of it (only one may go through), then a refund, and two simultaneous refunds of
 * the rest (only one may go through). Saves Stripe's test Visa (pm_card_visa) to the client first. Usage (from apps/web):
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/money-smoke.ts
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { stripe } from "../src/lib/stripe";
import { demoAccountId, demoStripeConfigured } from "../src/lib/stripe-demo";
import { chargeCardOnFile, getSale, openFeeSaleForAppointment, refundPayment } from "../src/server/sales";
import { ensureStripeCustomer } from "../src/server/stripe-connect";

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run against a non-local database.");
  if (!demoStripeConfigured()) throw new Error("Demo Stripe keys are not set.");
  const accountId = await demoAccountId();
  const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, "demo-salon") });
  if (!accountId || !biz || biz.stripeAccountId !== accountId) throw new Error("demo-salon is not linked to the demo Stripe account (run scripts/link-demo-stripe.ts).");
  const actor = (await db.query.member.findFirst({ where: and(eq(schema.member.organizationId, biz.id), eq(schema.member.role, "owner")) }))!.userId;

  // A visit that was never rung up, with a client (the demo's past visits are all checked out, so the next upcoming one).
  const appt = await withTenant(biz.id, async (tx) => {
    const rows = await tx.execute<{ id: string; client_id: string }>(sql`
      select a.id, a.client_id from appointments a join appointment_items i on i.appointment_id = a.id and i.sort_order = 0
      where a.client_id is not null and a.status in ('booked','confirmed') 
        and not exists (select 1 from sales s where s.appointment_id = a.id and s.status <> 'void')
      order by i.start_at limit 1`);
    return rows[0];
  });
  if (!appt) throw new Error("No un-rung demo appointment to use.");
  const client = (await withTenant(biz.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, appt.client_id) })))!;
  const customer = await ensureStripeCustomer({ accountId, businessId: biz.id, client });
  const pm = await stripe().paymentMethods.attach("pm_card_visa", { customer }, { stripeAccount: accountId });
  console.log(`appointment ${appt.id}, client ${client.firstName}, card ${pm.id}`);

  const saleId = await openFeeSaleForAppointment({ businessId: biz.id, appointmentId: appt.id, name: "No-show fee", feeCents: 2500, actorUserId: actor, taxRateBps: biz.taxRateBps, currency: biz.currency, auditAction: "appointment.no_show_fee" });
  const charge = () => chargeCardOnFile({ businessId: biz.id, accountId, saleId, paymentMethodId: pm.id, amountCents: 2500, actorUserId: actor, taxRateBps: biz.taxRateBps });
  const both = await Promise.allSettled([charge(), charge()]);
  console.log("two charges at once:", both.map((r) => (r.status === "fulfilled" ? r.value : `refused: ${(r.reason as Error).message}`)));
  let d = (await getSale(biz.id, saleId))!;
  console.log("sale:", d.sale.status, "paid", d.sale.paidCents, "payments", d.payments.map((p) => [p.status, p.amountCents, p.cardLast4]));
  const appointment = await withTenant(biz.id, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appt.id) }));
  console.log("appointment status after fee:", appointment?.status, "(should not be completed)");

  const paid = d.payments.find((p) => p.status === "succeeded")!;
  await refundPayment({ businessId: biz.id, accountId, paymentId: paid.id, amountCents: 1000, reason: "smoke test", actorUserId: actor, taxRateBps: biz.taxRateBps });
  const refunds = await Promise.allSettled([1500, 1500].map((c) => refundPayment({ businessId: biz.id, accountId, paymentId: paid.id, amountCents: c, reason: "smoke test", actorUserId: actor, taxRateBps: biz.taxRateBps })));
  console.log("two refunds of the rest at once:", refunds.map((r) => (r.status === "fulfilled" ? "ok" : `refused: ${(r.reason as Error).message}`)));
  d = (await getSale(biz.id, saleId))!;
  const pi = await stripe().paymentIntents.retrieve(paid.stripePaymentIntentId!, { expand: ["latest_charge"] }, { stripeAccount: accountId });
  const ch = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  console.log("after refunds: sale", d.sale.status, "refunded", d.sale.refundedCents, "| Stripe amount_refunded", ch?.amount_refunded);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
