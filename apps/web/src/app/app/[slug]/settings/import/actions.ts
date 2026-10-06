"use server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { parseTable } from "@/lib/import/parse";
import { autoMap, FIELDS, IMPORT_KINDS, type ImportKind } from "@/lib/import/mapping";
import { runImport } from "@/server/import";

export type UploadState = { error?: string } | undefined;
export type Staged = { id: string; businessId: string; kind: ImportKind; filename: string; headers: string[]; rows: Record<string, string>[]; mapping: Record<string, string> };

const dir = join(tmpdir(), "angelic-imports");
const pathFor = (id: string) => join(dir, `${id}.json`);

export async function readStaged(businessId: string, id: string): Promise<Staged | null> {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  try {
    const s = JSON.parse(await readFile(pathFor(id), "utf8")) as Staged;
    return s.businessId === businessId ? s : null;
  } catch {
    return null;
  }
}

/** Step 1: parse the upload, auto-map headers, stage it server-side, redirect to the preview. */
export async function uploadImport(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const slug = String(formData.get("slug"));
  const kind = z.enum(IMPORT_KINDS).parse(formData.get("kind"));
  const ctx = await requireAction(slug, "business.manage");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV or Excel file." };
  if (file.size > 25 * 1024 * 1024) return { error: "File is too large (25 MB max)." };
  const table = await parseTable({ name: file.name, bytes: await file.arrayBuffer() });
  if (!table.rows.length) return { error: "No rows found in that file." };
  const id = crypto.randomUUID();
  const staged: Staged = { id, businessId: ctx.business.id, kind, filename: file.name, headers: table.headers, rows: table.rows, mapping: autoMap(kind, table.headers) };
  await mkdir(dir, { recursive: true });
  await writeFile(pathFor(id), JSON.stringify(staged));
  redirect(`/app/${slug}/settings/import?staged=${id}`);
}

/** Step 2: apply the (possibly edited) mapping and import. */
export async function commitImport(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("staged"));
  const ctx = await requireAction(slug, "business.manage");
  const staged = await readStaged(ctx.business.id, id);
  if (!staged) return { error: "This upload has expired. Please upload the file again." };
  const mapping: Record<string, string> = {};
  for (const f of FIELDS[staged.kind]) {
    const h = String(formData.get(`map_${f.key}`) ?? "");
    if (h && staged.headers.includes(h)) mapping[f.key] = h;
  }
  const missing = FIELDS[staged.kind].filter((f) => f.required && !mapping[f.key] && !(staged.kind === "clients" && f.key === "firstName" && mapping.fullName));
  if (missing.length) return { error: `Map these columns first: ${missing.map((m) => m.label).join(", ")}` };
  const result = await runImport(ctx.business, staged.kind, staged.rows, mapping, ctx.user.id, staged.filename);
  redirect(`/app/${slug}/settings/import?done=${encodeURIComponent(JSON.stringify({ kind: staged.kind, ...result, errors: result.errors.slice(0, 20) }))}`);
}
