/**
 * Family and linked clients: a child, a partner, a parent. Links are stored both ways (see schema.clientLinks), so either person's
 * page lists the other. Each person keeps their own appointments, notes and forms; the link only adds a "Book for…" shortcut, lets a
 * signed-in client book for their family online, and lets a child without a phone or email get their messages at a parent's.
 */
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";

export type Relation = "child" | "parent" | "partner" | "other";
export const RELATIONS: { value: Relation; label: string }[] = [
  { value: "child", label: "Child" },
  { value: "parent", label: "Parent" },
  { value: "partner", label: "Partner" },
  { value: "other", label: "Other" },
];

/** What the client is to the linked person, given what the linked person is to the client. */
export function inverseRelation(r: Relation): Relation {
  return r === "child" ? "parent" : r === "parent" ? "child" : r;
}

export class LinkError extends Error {}

/** Link two clients: `relation` is what `linkedClientId` is to `clientId` ("Mia is Jen's child"). Relinking changes the relation. */
export async function linkClientsTx(tx: TenantDb, businessId: string, clientId: string, linkedClientId: string, relation: Relation) {
  if (clientId === linkedClientId) throw new LinkError("A client can't be linked to themselves.");
  const found = await tx.select({ id: schema.clients.id }).from(schema.clients).where(inArray(schema.clients.id, [clientId, linkedClientId]));
  if (found.length !== 2) throw new LinkError("Client not found.");
  for (const [a, b, r] of [[clientId, linkedClientId, relation], [linkedClientId, clientId, inverseRelation(relation)]] as const) {
    await tx.insert(schema.clientLinks).values({ businessId, clientId: a, linkedClientId: b, relation: r }).onConflictDoUpdate({ target: [schema.clientLinks.clientId, schema.clientLinks.linkedClientId], set: { relation: r } });
  }
}

export async function linkClients(input: { businessId: string; clientId: string; linkedClientId: string; relation: Relation; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    await linkClientsTx(tx, input.businessId, input.clientId, input.linkedClientId, input.relation);
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "client.link", entity: "client", entityId: input.clientId, diff: JSON.stringify({ linkedClientId: input.linkedClientId, relation: input.relation }) });
  });
}

export async function unlinkClients(input: { businessId: string; clientId: string; linkedClientId: string; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const { clientId: a, linkedClientId: b } = input;
    await tx.delete(schema.clientLinks).where(or(and(eq(schema.clientLinks.clientId, a), eq(schema.clientLinks.linkedClientId, b)), and(eq(schema.clientLinks.clientId, b), eq(schema.clientLinks.linkedClientId, a))));
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "client.unlink", entity: "client", entityId: a, diff: JSON.stringify({ linkedClientId: b }) });
  });
}

export type LinkedClient = { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; relation: Relation };

/** The people linked to a client, with what each one is to them. */
export async function linkedClientsTx(tx: TenantDb, clientId: string): Promise<LinkedClient[]> {
  const rows = await tx
    .select({ id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName, phone: schema.clients.phone, email: schema.clients.email, relation: schema.clientLinks.relation })
    .from(schema.clientLinks)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.clientLinks.linkedClientId))
    .where(eq(schema.clientLinks.clientId, clientId))
    .orderBy(asc(schema.clients.firstName), asc(schema.clients.lastName));
  return rows;
}

export async function linkedClients(businessId: string, clientId: string) {
  return withTenant(businessId, (tx) => linkedClientsTx(tx, clientId));
}

type Reachable = { id: string; phone: string | null; email: string | null; smsOptIn: boolean; emailOptIn: boolean };

/**
 * Where appointment messages for this client go. Their own phone and email; for one they don't have (a child), a parent's, with that
 * parent's consent for the channel. Marketing never uses this: it is the parent's own consent to the visit's messages only.
 */
export async function appointmentContact<C extends Reachable>(tx: TenantDb, client: C): Promise<C & { via: string | null }> {
  if (client.phone && client.email) return { ...client, via: null };
  const [parent] = await tx
    .select({ id: schema.clients.id, phone: schema.clients.phone, email: schema.clients.email, smsOptIn: schema.clients.smsOptIn, emailOptIn: schema.clients.emailOptIn })
    .from(schema.clientLinks)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.clientLinks.linkedClientId))
    .where(and(eq(schema.clientLinks.clientId, client.id), eq(schema.clientLinks.relation, "parent")))
    .orderBy(asc(schema.clientLinks.createdAt))
    .limit(1);
  if (!parent) return { ...client, via: null };
  const phone = client.phone ? { phone: client.phone, smsOptIn: client.smsOptIn } : { phone: parent.phone, smsOptIn: parent.smsOptIn };
  const email = client.email ? { email: client.email, emailOptIn: client.emailOptIn } : { email: parent.email, emailOptIn: parent.emailOptIn };
  const borrowed = (!client.phone && !!parent.phone) || (!client.email && !!parent.email);
  return { ...client, ...phone, ...email, via: borrowed ? parent.id : null };
}
