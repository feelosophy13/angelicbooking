"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { formAction, FormError } from "@/lib/form";

const cents = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? "").trim().replace("$", "");
  if (!s) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
};
const whole = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return /^\d{1,7}$/.test(s) ? Number(s) : NaN;
};

/** Save the table: only products that actually changed are written. */
export const saveBulk = formAction(z.object({ slug: z.string() }), async (d, raw) => {
  const ctx = await requireAction(d.slug, "services.manage");
  const ids = raw.getAll("id").map(String);
  const bad: string[] = [];
  let changed = 0;
  await withTenant(ctx.business.id, async (tx) => {
    const current = await tx.select().from(schema.products);
    const suppliers = new Set((await tx.select({ id: schema.suppliers.id }).from(schema.suppliers)).map((x) => x.id));
    for (const id of ids) {
      const p = current.find((x) => x.id === id);
      if (!p) continue;
      const price = cents(raw.get(`price:${id}`));
      const cost = cents(raw.get(`cost:${id}`));
      const low = whole(raw.get(`low:${id}`));
      const upto = whole(raw.get(`upto:${id}`));
      if ([price, cost, low, upto].some((n) => Number.isNaN(n))) {
        bad.push(p.name);
        continue;
      }
      const supplierId = String(raw.get(`supplier:${id}`) ?? "") || null;
      if (supplierId && !suppliers.has(supplierId)) {
        bad.push(`${p.name} (unknown supplier)`);
        continue;
      }
      const active = raw.get(`active:${id}`) === "on";
      const next = {
        priceCents: p.kind === "backbar" ? p.priceCents : (price ?? p.priceCents),
        // A blank cost leaves the cost as it was (it isn't "free").
        costCents: cost ?? p.costCents,
        lowStockThreshold: low ?? p.lowStockThreshold,
        reorderUpTo: upto,
        supplierId,
        active,
      };
      if (next.reorderUpTo != null && next.reorderUpTo < next.lowStockThreshold) {
        bad.push(`${p.name} (order up to is under the low-stock level)`);
        continue;
      }
      if (next.priceCents === p.priceCents && next.costCents === p.costCents && next.lowStockThreshold === p.lowStockThreshold && next.reorderUpTo === p.reorderUpTo && next.supplierId === p.supplierId && next.active === p.active) continue;
      await tx.update(schema.products).set(next).where(eq(schema.products.id, id));
      changed++;
    }
  });
  revalidatePath(`/app/${d.slug}/products`);
  revalidatePath(`/app/${d.slug}/inventory`, "layout");
  if (bad.length) throw new FormError(`Not saved, check the numbers for: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? "…" : ""}`);
  return changed ? `${changed} product${changed === 1 ? "" : "s"} updated` : "Nothing changed";
});
