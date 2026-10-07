/** Build a CSV response. Values are quoted when needed; Excel-friendly BOM included. */
export function csvResponse(filename: string, headers: string[], rows: (string | number | null | undefined)[][]): Response {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = "﻿" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });
}
