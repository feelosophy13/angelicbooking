"use server";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/tenant";
import { parseTable, TableError } from "@/lib/import/parse";
import { readProductRows } from "@/lib/inventory";
import { importProducts, type ImportSummary } from "@/server/inventory";

export type ImportState = { error?: string; done?: boolean; dryRun?: boolean; summary?: ImportSummary; problems?: string[] } | undefined;

const MAX_BYTES = 2 * 1024 * 1024;

/** Check a product spreadsheet (nothing is changed) or import it. Rows match existing products by barcode, SKU, then name and option. */
export async function importProductSheet(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const slug = String(fd.get("slug"));
  const ctx = await requireAction(slug, "services.manage");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a spreadsheet (.csv or .xlsx)." };
  if (file.size > MAX_BYTES) return { error: "That file is over 2 MB. Split it into smaller files." };
  const dryRun = fd.get("dryRun") === "on";
  let table: Awaited<ReturnType<typeof parseTable>>;
  try {
    table = await parseTable({ name: file.name, bytes: await file.arrayBuffer() });
  } catch (e) {
    if (e instanceof TableError) return { error: e.message };
    throw e;
  }
  const { rows, errors } = readProductRows([table.headers, ...table.rows.map((r) => table.headers.map((h) => r[h] ?? ""))]);
  if (!rows.length) return { error: errors[0] ?? "No products found in that file." };
  const summary = await importProducts({ businessId: ctx.business.id, rows, dryRun, actorUserId: ctx.user.id });
  if (!dryRun) {
    revalidatePath(`/app/${slug}/products`);
    revalidatePath(`/app/${slug}/inventory`, "layout");
  }
  return { done: true, dryRun, summary, problems: [...errors, ...summary.skipped] };
}
