"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { applyCount, cancelOrder, createPurchaseOrder, InventoryError, markOrdered, receiveOrder, recordMovement, setPoLine, updatePurchaseOrder } from "@/server/inventory";

const refresh = (slug: string) => {
  revalidatePath(`/app/${slug}/inventory`, "layout");
  revalidatePath(`/app/${slug}/products`);
};
const wrap = async <T,>(field: string | undefined, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof InventoryError) throw new FormError(e.message, field);
    throw e;
  }
};
const intOf = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return /^-?\d{1,7}$/.test(s) ? Number(s) : s === "" ? null : NaN;
};
const centsOf = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace("$", "");
  if (!s) return null;
  return /^\d{1,7}(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : NaN;
};

// ---- Receive stock without an order ----

/** A delivery with no purchase order: one quantity per product, one note. */
export const receiveStock = formAction(z.object({ slug: z.string(), locationId: z.string().optional(), note: f.optional(200) }), async (d, raw) => {
  const ctx = await requireAction(d.slug, "inventory.manage");
  let units = 0;
  let products = 0;
  for (const [key, v] of raw.entries()) {
    if (!key.startsWith("qty:")) continue;
    const qty = intOf(v as string);
    if (qty == null) continue;
    if (Number.isNaN(qty) || qty < 0) throw new FormError("Quantities are whole numbers.");
    if (qty === 0) continue;
    await wrap(undefined, () => recordMovement({ businessId: ctx.business.id, productId: key.slice(4), locationId: d.locationId || null, entered: qty, reason: "received", note: d.note, actorUserId: ctx.user.id }));
    units += qty;
    products++;
  }
  if (!units) throw new FormError("Enter how many arrived for at least one product.");
  refresh(d.slug);
  return `Received ${units} unit${units === 1 ? "" : "s"} of ${products} product${products === 1 ? "" : "s"}`;
});

// ---- Count ----

export const submitCount = formAction(z.object({ slug: z.string(), locationId: z.string(), note: f.optional(120) }), async (d, raw) => {
  const ctx = await requireAction(d.slug, "inventory.manage");
  const counts: { productId: string; counted: number }[] = [];
  for (const [key, v] of raw.entries()) {
    if (!key.startsWith("count:")) continue;
    const n = intOf(v as string);
    if (n == null) continue;
    if (Number.isNaN(n) || n < 0) throw new FormError("Counts are whole numbers, zero or more.");
    counts.push({ productId: key.slice(6), counted: n });
  }
  if (!counts.length) throw new FormError("Enter at least one count. Products you leave blank aren't touched.");
  const r = await wrap(undefined, () => applyCount({ businessId: ctx.business.id, locationId: d.locationId, counts, note: d.note, actorUserId: ctx.user.id }));
  refresh(d.slug);
  return r.changed ? `${r.counted} counted, ${r.changed} corrected (${r.unitsOff} unit${r.unitsOff === 1 ? "" : "s"} off)` : `${r.counted} counted: all correct`;
});

// ---- Suppliers ----

const supplierFields = z.object({ slug: z.string(), supplierId: z.string().optional(), name: f.text(1, 80), contactName: f.optional(80), email: f.email(), phone: f.optional(40), accountNumber: f.optional(60), notes: f.optional(500) });

export const saveSupplier = formAction(supplierFields, async (d) => {
  const ctx = await requireAction(d.slug, "inventory.manage");
  const values = { name: d.name, contactName: d.contactName, email: d.email, phone: d.phone, accountNumber: d.accountNumber, notes: d.notes };
  if (d.supplierId) await withTenant(ctx.business.id, (tx) => tx.update(schema.suppliers).set(values).where(eq(schema.suppliers.id, d.supplierId!)));
  else await withTenant(ctx.business.id, (tx) => tx.insert(schema.suppliers).values({ businessId: ctx.business.id, ...values }));
  refresh(d.slug);
  if (!d.supplierId) {
    await setFlash(`${d.name} added`);
    redirect(`/app/${d.slug}/inventory/suppliers`);
  }
  return "Supplier saved";
});

export async function toggleSupplier(fd: FormData) {
  const slug = String(fd.get("slug"));
  const ctx = await requireAction(slug, "inventory.manage");
  const active = fd.get("active") === "true";
  await withTenant(ctx.business.id, (tx) => tx.update(schema.suppliers).set({ active }).where(eq(schema.suppliers.id, String(fd.get("supplierId")))));
  await setFlash(active ? "Supplier shown again" : "Supplier hidden");
  refresh(slug);
}

// ---- Purchase orders ----

const dateOrNull = z.string().optional().transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null));

export const newOrder = formAction(z.object({ slug: z.string(), supplierId: z.string().optional(), locationId: z.string().optional(), expectedOn: dateOrNull, notes: f.optional(500) }), async (d) => {
  const ctx = await requireAction(d.slug, "inventory.manage");
  const po = await createPurchaseOrder({ businessId: ctx.business.id, supplierId: d.supplierId || null, locationId: d.locationId || null, expectedOn: d.expectedOn, notes: d.notes, actorUserId: ctx.user.id });
  refresh(d.slug);
  redirect(`/app/${d.slug}/inventory/orders/${po.id}`);
});

/** From the Reorder tab: one supplier's suggested products (quantities as edited) become a draft order. */
export const orderFromSuggestions = formAction(z.object({ slug: z.string(), supplierId: z.string().optional(), locationId: z.string().optional() }), async (d, raw) => {
  const ctx = await requireAction(d.slug, "inventory.manage");
  const lines: { productId: string; qty: number }[] = [];
  for (const [key, v] of raw.entries()) {
    if (!key.startsWith("qty:")) continue;
    const qty = intOf(v as string);
    if (qty == null || qty === 0) continue;
    if (Number.isNaN(qty) || qty < 0) throw new FormError("Quantities are whole numbers.");
    lines.push({ productId: key.slice(4), qty });
  }
  if (!lines.length) throw new FormError("Choose at least one product to order.");
  const po = await createPurchaseOrder({ businessId: ctx.business.id, supplierId: d.supplierId || null, locationId: d.locationId || null, lines, actorUserId: ctx.user.id });
  refresh(d.slug);
  await setFlash(`Order #${po.number} drafted`);
  redirect(`/app/${d.slug}/inventory/orders/${po.id}`);
});

export const saveOrder = formAction(z.object({ slug: z.string(), orderId: f.id(), supplierId: z.string().optional(), locationId: z.string().optional(), expectedOn: dateOrNull, reference: f.optional(80), notes: f.optional(500) }), async (d, raw) => {
  const ctx = await requireAction(d.slug, "inventory.manage");
  await wrap(undefined, async () => {
    await updatePurchaseOrder({ businessId: ctx.business.id, id: d.orderId, supplierId: d.supplierId || null, locationId: d.locationId || null, expectedOn: d.expectedOn, notes: d.notes, reference: d.reference });
    // Quantities and unit costs on the lines (a quantity of 0 removes the line).
    for (const [key, v] of raw.entries()) {
      if (!key.startsWith("ord:")) continue;
      const productId = key.slice(4);
      const qty = intOf(v as string);
      const cost = centsOf(raw.get(`cost:${productId}`));
      if (qty == null || Number.isNaN(qty) || qty < 0 || (cost != null && Number.isNaN(cost))) throw new InventoryError("Quantities are whole numbers and costs are amounts like 4.50.");
      await setPoLine({ businessId: ctx.business.id, id: d.orderId, productId, qty, unitCostCents: cost });
    }
  });
  refresh(d.slug);
  return "Order saved";
});

export const addOrderLine = formAction(z.object({ slug: z.string(), orderId: f.id(), productId: f.id(), qty: f.int(1, 100000) }), async (d) => {
  const ctx = await requireAction(d.slug, "inventory.manage");
  await wrap("qty", () => setPoLine({ businessId: ctx.business.id, id: d.orderId, productId: d.productId, qty: d.qty }));
  refresh(d.slug);
  return "Added";
});

export async function orderAction(fd: FormData) {
  const slug = String(fd.get("slug"));
  const id = String(fd.get("orderId"));
  const ctx = await requireAction(slug, "inventory.manage");
  const what = String(fd.get("do"));
  try {
    if (what === "order") {
      await markOrdered({ businessId: ctx.business.id, id, actorUserId: ctx.user.id });
      await setFlash("Marked as ordered");
    } else if (what === "cancel") {
      await cancelOrder({ businessId: ctx.business.id, id, actorUserId: ctx.user.id });
      await setFlash("Order cancelled");
    }
  } catch (e) {
    if (e instanceof InventoryError) await setFlash(e.message, "error");
    else throw e;
  }
  refresh(slug);
}

export const receiveOrderAction = formAction(z.object({ slug: z.string(), orderId: f.id(), reference: f.optional(80) }), async (d, raw) => {
  const ctx = await requireAction(d.slug, "inventory.manage");
  const lines: { lineId: string; qty: number; unitCostCents: number | null }[] = [];
  for (const [key, v] of raw.entries()) {
    if (!key.startsWith("got:")) continue;
    const lineId = key.slice(4);
    const qty = intOf(v as string);
    const cost = centsOf(raw.get(`paid:${lineId}`));
    if (qty == null) continue;
    if (Number.isNaN(qty) || qty < 0 || (cost != null && Number.isNaN(cost))) throw new FormError("Quantities are whole numbers and costs are amounts like 4.50.");
    lines.push({ lineId, qty, unitCostCents: cost });
  }
  const r = await wrap(undefined, () => receiveOrder({ businessId: ctx.business.id, id: d.orderId, lines, reference: d.reference, actorUserId: ctx.user.id }));
  refresh(d.slug);
  return r.done ? `Received ${r.units} unit${r.units === 1 ? "" : "s"}. The order is complete.` : `Received ${r.units} unit${r.units === 1 ? "" : "s"}. The rest is still on order.`;
});
