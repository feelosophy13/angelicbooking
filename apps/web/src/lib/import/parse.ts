import ExcelJS from "exceljs";

export type Table = { headers: string[]; rows: Record<string, string>[] };

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => r.some((v) => v.trim() !== ""));
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("error" in v) return "";
  }
  return String(v);
}

async function xlsxToGrid(buf: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) vals.push(cellText(row.getCell(c).value).trim());
    grid.push(vals);
  });
  return grid;
}

/**
 * Vagaro exports often have title rows above the real header. Pick the first
 * row with at least 3 non-empty cells that looks like headers (mostly text).
 */
function findHeaderRow(grid: string[][]): number {
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const r = grid[i]!;
    const nonEmpty = r.filter((v) => v.trim() !== "");
    if (nonEmpty.length >= 3 && nonEmpty.every((v) => !/^\d+([.,]\d+)?$/.test(v.trim()))) return i;
  }
  return 0;
}

export async function parseTable(file: { name: string; bytes: ArrayBuffer }): Promise<Table> {
  const grid = /\.xlsx?$/i.test(file.name) ? await xlsxToGrid(file.bytes) : parseCsv(new TextDecoder().decode(file.bytes));
  if (!grid.length) return { headers: [], rows: [] };
  const h = findHeaderRow(grid);
  const headers = grid[h]!.map((x, i) => (x.trim() || `Column ${i + 1}`));
  const rows = grid.slice(h + 1).map((r) => Object.fromEntries(headers.map((k, i) => [k, (r[i] ?? "").trim()])));
  return { headers, rows };
}
