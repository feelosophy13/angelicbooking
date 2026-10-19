import { pathTo, type AnyCategory } from "@/server/categories";

/** One category row of the Reports "Revenue by service category" table, with its second-level sub-categories. All money in cents. */
export type CategoryRow = {
  id: string;
  name: string;
  /** Service lines (paid and covered) on closed sales. */
  count: number;
  /** Paid at the visit. */
  paid: number;
  /** Package and membership sessions used on these services, at the session's value. */
  credit: number;
  /** What Payroll credits providers on these lines (commission; null when pay is not shown). */
  pay: number | null;
  /** The previous period's paid + credit, for the change column. */
  before: number;
  children: CategoryRow[];
};

export type CategoryInput = { categoryId: string | null; count: number; amount: number; credit: number };

const blank = (id: string, name: string): CategoryRow => ({ id, name, count: 0, paid: 0, credit: 0, pay: null, before: 0, children: [] });

/**
 * Leaf categories roll up into their top-level category, with the second level listed under it. `pay` (by leaf category id, `null`
 * for uncategorised) is joined in the same way; without it every row's pay is null. Rows come back sorted by paid + credit, largest first.
 */
export function rollUpCategories(rows: CategoryInput[], categories: AnyCategory[], pay?: Map<string | null, number> | null): CategoryRow[] {
  const tops = new Map<string, CategoryRow>();
  const other = blank("none", "Uncategorized");
  const add = (t: CategoryRow, r: { count: number; amount: number; credit: number; pay: number | null }) => {
    t.count += Number(r.count);
    t.paid += Number(r.amount);
    t.credit += Number(r.credit);
    if (r.pay !== null) t.pay = (t.pay ?? 0) + r.pay;
  };
  // A category with pay but no sales in the range (a refund clawback this period on last period's visit) still needs a row.
  const keys = new Set<string | null>(rows.map((r) => r.categoryId));
  for (const k of pay?.keys() ?? []) keys.add(k);
  for (const key of keys) {
    const sold = rows.filter((r) => r.categoryId === key);
    const r = { count: sold.reduce((n, x) => n + Number(x.count), 0), amount: sold.reduce((n, x) => n + Number(x.amount), 0), credit: sold.reduce((n, x) => n + Number(x.credit), 0), pay: pay ? (pay.get(key) ?? 0) : null };
    const path = key ? pathTo(categories, key) : [];
    const top = path[0];
    if (!top) { add(other, r); continue; }
    if (!tops.has(top.id)) tops.set(top.id, blank(top.id, top.name));
    const t = tops.get(top.id)!;
    add(t, r);
    const second = path[1];
    if (second) {
      let c = t.children.find((x) => x.id === second.id);
      if (!c) { c = blank(second.id, second.name); t.children.push(c); }
      add(c, r);
    }
  }
  const out = [...tops.values()];
  if (other.count || other.pay) out.push(other);
  const total = (r: CategoryRow) => r.paid + r.credit;
  for (const t of out) t.children.sort((x, y) => total(y) - total(x));
  return out.sort((x, y) => total(y) - total(x));
}

/** Fill `before` from the previous period's roll-up (matched by id at both levels). */
export function withPrevious(rows: CategoryRow[], previous: CategoryRow[]): CategoryRow[] {
  for (const t of rows) {
    const b = previous.find((x) => x.id === t.id);
    t.before = b ? b.paid + b.credit : 0;
    for (const c of t.children) {
      const bc = b?.children.find((x) => x.id === c.id);
      c.before = bc ? bc.paid + bc.credit : 0;
    }
  }
  return rows;
}
