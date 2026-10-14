"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { GroupError, quickCreateOption } from "@/server/product-groups";
import { productLabel } from "@/lib/inventory";
import { setFlash } from "@/lib/flash";
import { applyCount, attachBarcode, quickCreateProduct, trackedProductIds, logUsage, togglePin, undoMovement, cancelOrder, createPurchaseOrder, InventoryError, markOrdered, receiveOrder, recordMovement, setPoLine, updatePurchaseOrder } from "@/server/inventory";

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

// ---- Log supplies used ----

/** One product, one click: a stylist logs what they used. Goes against the chosen location; may leave a count negative rather than stop the work. */
export async function logUsageQuick(formData: FormData) {
  const d = z.object({ slug: z.string(), productId: f.id(), locationId: z.string().optional(), qty: z.coerce.number().int("Whole units only.").min(1, "Enter how many.").max(1000) }).safeParse(Object.fromEntries(formData));
  if (!d.success) {
    await setFlash(d.error.issues[0]?.message ?? "Check the amount.", "error");
    return;
  }
  const ctx = await requireAction(d.data.slug, "inventory.log");
  try {
    await logUsage({ businessId: ctx.business.id, locationId: d.data.locationId || null, items: [{ productId: d.data.productId, qty: d.data.qty }], note: null, actorUserId: ctx.user.id });
    const p = await withTenant(ctx.business.id, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, d.data.productId), columns: { name: true, variantLabel: true } }));
    await setFlash(`Logged ${d.data.qty} × ${p ? productLabel(p) : "product"}`, "success");
  } catch (e) {
    if (e instanceof InventoryError) await setFlash(e.message, "error");
    else throw e;
  }
  refresh(d.data.slug);
}

/** Keep a product at the top of Log usage for this person (press again to unpin). */
export async function togglePinAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "inventory.log");
  await togglePin({ businessId: ctx.business.id, userId: ctx.user.id, productId: String(formData.get("productId")) });
  revalidatePath(`/app/${slug}/inventory/use`);
}

/** Take back something logged by mistake (your own entry, or anyone's if you manage inventory). */
export async function undoLoggedAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "inventory.log");
  try {
    await undoMovement({ businessId: ctx.business.id, movementId: String(formData.get("movementId")), actorUserId: ctx.user.id, canManage: can(ctx.permissions, "inventory.manage") });
    await setFlash("Taken back", "success");
  } catch (e) {
    if (e instanceof InventoryError) await setFlash(e.message, "error");
    else throw e;
  }
  refresh(slug);
}

// ---- Scanning ----

export type ScanResult = { ok: true; message: string } | { ok: false; error: string };
const asResult = async (fn: () => Promise<string>): Promise<ScanResult> => {
  try {
    return { ok: true, message: await fn() };
  } catch (e) {
    if (e instanceof InventoryError) return { ok: false, error: e.message };
    throw e;
  }
};
const scanLines = z.array(z.object({ productId: z.string().min(1), qty: z.number().int().min(1).max(100000) })).min(1, "Scan something first.").max(500);

/** A delivery with no order, from a scanning session: each product with how many were scanned. */
export async function receiveScannedAction(input: { slug: string; locationId: string | null; note: string; lines: { productId: string; qty: number }[] }): Promise<ScanResult> {
  const ctx = await requireAction(input.slug, "inventory.manage");
  const lines = scanLines.safeParse(input.lines);
  if (!lines.success) return { ok: false, error: lines.error.issues[0]?.message ?? "Check the quantities." };
  return asResult(async () => {
    let units = 0;
    for (const l of lines.data) {
      await recordMovement({ businessId: ctx.business.id, productId: l.productId, locationId: input.locationId || null, entered: l.qty, reason: "received", note: input.note.trim().slice(0, 200) || "Scanned delivery", actorUserId: ctx.user.id });
      units += l.qty;
    }
    refresh(input.slug);
    return `Received ${units} unit${units === 1 ? "" : "s"} of ${lines.data.length} product${lines.data.length === 1 ? "" : "s"}`;
  });
}

/** A delivery against an order: scanned quantities per order line. */
export async function receiveOrderScannedAction(input: { slug: string; orderId: string; reference: string; lines: { lineId: string; qty: number }[] }): Promise<ScanResult> {
  const ctx = await requireAction(input.slug, "inventory.manage");
  const lines = z.array(z.object({ lineId: z.string().min(1), qty: z.number().int().min(1).max(100000) })).min(1, "Scan something first.").safeParse(input.lines);
  if (!lines.success) return { ok: false, error: lines.error.issues[0]?.message ?? "Check the quantities." };
  return asResult(async () => {
    const r = await receiveOrder({ businessId: ctx.business.id, id: input.orderId, lines: lines.data, reference: input.reference.trim().slice(0, 80) || null, actorUserId: ctx.user.id });
    refresh(input.slug);
    return r.done ? `Received ${r.units} unit${r.units === 1 ? "" : "s"}. The order is complete.` : `Received ${r.units} unit${r.units === 1 ? "" : "s"}. The rest is still on order.`;
  });
}

/** A count from scanning each item on the shelf. With `zeroRest`, tracked products that weren't scanned are counted as none. */
export async function countScannedAction(input: { slug: string; locationId: string; note: string; zeroRest: boolean; counts: { productId: string; counted: number }[] }): Promise<ScanResult> {
  const ctx = await requireAction(input.slug, "inventory.manage");
  const counts = z.array(z.object({ productId: z.string().min(1), counted: z.number().int().min(0).max(100000) })).max(1000).safeParse(input.counts);
  if (!counts.success) return { ok: false, error: "Check the counts." };
  if (!counts.data.length && !input.zeroRest) return { ok: false, error: "Scan something first." };
  return asResult(async () => {
    const list = [...counts.data];
    if (input.zeroRest) {
      const seen = new Set(list.map((c) => c.productId));
      for (const id of await trackedProductIds(ctx.business.id)) if (!seen.has(id)) list.push({ productId: id, counted: 0 });
    }
    const r = await applyCount({ businessId: ctx.business.id, locationId: input.locationId, counts: list, note: input.note.trim().slice(0, 120) || "Scanned count", actorUserId: ctx.user.id });
    refresh(input.slug);
    return r.changed ? `${r.counted} counted, ${r.changed} corrected (${r.unitsOff} unit${r.unitsOff === 1 ? "" : "s"} off)` : `${r.counted} counted: all correct`;
  });
}

/** Save a scanned barcode on the product it belongs to: as its first barcode, in place of its barcode, or as another one (a pack size). */
export async function attachBarcodeAction(input: { slug: string; productId: string; code: string; mode: "set" | "replace" | "add"; units?: number }): Promise<ScanResult> {
  const ctx = await requireAction(input.slug, "inventory.manage");
  return asResult(async () => {
    const label = await attachBarcode({ businessId: ctx.business.id, productId: input.productId, code: input.code, mode: input.mode, units: input.units, actorUserId: ctx.user.id });
    refresh(input.slug);
    return input.mode === "add" ? `Added as another barcode of ${label}${input.units && input.units > 1 ? ` (${input.units} units a scan)` : ""}` : `Saved on ${label}`;
  });
}

export type CreatedProduct = { id: string; label: string; barcode: string; sku: null; category: string | null; onHand: number; tracked: boolean; codes: { code: string; units: number }[] };

/** A scan that matched nothing and no existing product fits: make the product on the spot, with the scanned code as its barcode. */
export async function createProductFromScanAction(input: { slug: string; code: string; name: string; kind: "retail" | "backbar"; price: string; cost: string; categoryId: string }): Promise<{ ok: true; product: CreatedProduct } | { ok: false; error: string }> {
  const ctx = await requireAction(input.slug, "inventory.manage");
  const cents = (v: string) => {
    const t = v.trim().replace("$", "");
    return /^\d{1,7}(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : t === "" ? 0 : NaN;
  };
  const price = cents(input.price);
  const cost = cents(input.cost);
  if (Number.isNaN(price) || Number.isNaN(cost)) return { ok: false, error: "Enter amounts like 24 or 24.50." };
  try {
    const product = await quickCreateProduct({ businessId: ctx.business.id, name: input.name, kind: input.kind === "backbar" ? "backbar" : "retail", priceCents: price, costCents: cost, categoryId: input.categoryId || null, code: input.code, actorUserId: ctx.user.id });
    refresh(input.slug);
    return { ok: true, product };
  } catch (e) {
    if (e instanceof InventoryError) return { ok: false, error: e.message };
    throw e;
  }
}

/** A scan that matched nothing, and it is a new size or shade of a product that already has options: make that option with the scanned barcode. */
export async function createOptionFromScanAction(input: { slug: string; code: string; groupId: string; label: string; price: string; cost: string }): Promise<{ ok: true; product: CreatedProduct } | { ok: false; error: string }> {
  const ctx = await requireAction(input.slug, "inventory.manage");
  const cents = (v: string) => {
    const t = v.trim().replace("$", "");
    return t === "" ? null : /^\d{1,7}(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : NaN;
  };
  const price = cents(input.price);
  const cost = cents(input.cost);
  if (Number.isNaN(price) || Number.isNaN(cost)) return { ok: false, error: "Enter amounts like 24 or 24.50." };
  try {
    const product = await quickCreateOption({ businessId: ctx.business.id, groupId: input.groupId, label: input.label, priceCents: price, costCents: cost, code: input.code, actorUserId: ctx.user.id });
    refresh(input.slug);
    return { ok: true, product };
  } catch (e) {
    if (e instanceof GroupError) return { ok: false, error: e.message };
    throw e;
  }
}
