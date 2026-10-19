"use server";
import { and, eq, lt } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema, withTenant } from "@angelic/db";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { parseTable, TableError } from "@/lib/import/parse";
import { autoMap, FIELDS, IMPORT_KINDS, type ImportKind } from "@/lib/import/mapping";
import { runImport } from "@/server/import";

export type UploadState = { error?: string } | undefined;
export type Staged = { id: string; businessId: string; kind: ImportKind; filename: string; headers: string[]; rows: Record<string, string>[]; mapping: Record<string, string> };

// Staged uploads live in the `files` table (kind "import_stage") so they survive restarts and
// work across instances; the files route never serves that kind. Stale stages are swept on upload.
const STAGE_KIND = "import_stage";
const STAGE_TTL_MS = 24 * 3_600_000;

export async function readStaged(businessId: string, id: string): Promise<Staged | null> {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const row = await withTenant(businessId, (tx) => tx.query.files.findFirst({ where: and(eq(schema.files.id, id), eq(schema.files.businessId, businessId), eq(schema.files.kind, STAGE_KIND)) }));
  if (!row || !row.data) return null;
  try {
    const s = JSON.parse(Buffer.from(row.data).toString("utf8")) as Staged;
    return s.businessId === businessId ? s : null;
  } catch {
    return null;
  }
}

async function discardStaged(businessId: string, id: string) {
  await withTenant(businessId, (tx) => tx.delete(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.kind, STAGE_KIND))));
}

/** Step 1: parse the upload, auto-map headers, stage it server-side, redirect to the preview. */
export async function uploadImport(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const slug = String(formData.get("slug"));
  const kind = z.enum(IMPORT_KINDS).parse(formData.get("kind"));
  const ctx = await requireAction(slug, "settings.business");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV or Excel file." };
  if (file.size > 25 * 1024 * 1024) return { error: "File is too large (25 MB max)." };
  let table: Awaited<ReturnType<typeof parseTable>>;
  try {
    table = await parseTable({ name: file.name, bytes: await file.arrayBuffer() });
  } catch (e) {
    if (e instanceof TableError) return { error: e.message };
    throw e;
  }
  if (!table.rows.length) return { error: "No rows found in that file." };
  await withTenant(ctx.business.id, (tx) => tx.delete(schema.files).where(and(eq(schema.files.businessId, ctx.business.id), eq(schema.files.kind, STAGE_KIND), lt(schema.files.createdAt, new Date(Date.now() - STAGE_TTL_MS)))));
  const id = crypto.randomUUID();
  const staged: Staged = { id, businessId: ctx.business.id, kind, filename: file.name, headers: table.headers, rows: table.rows, mapping: autoMap(kind, table.headers) };
  const data = Buffer.from(JSON.stringify(staged), "utf8");
  await withTenant(ctx.business.id, (tx) => tx.insert(schema.files).values({ id, businessId: ctx.business.id, kind: STAGE_KIND, contentType: "application/json", size: data.length, data }));
  redirect(`/app/${slug}/settings/import?staged=${id}`);
}

/** Step 2: apply the (possibly edited) mapping and import. */
export async function commitImport(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const slug = String(formData.get("slug"));
  const id = String(formData.get("staged"));
  const ctx = await requireAction(slug, "settings.business");
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
  await discardStaged(ctx.business.id, id);
  redirect(`/app/${slug}/settings/import?done=${encodeURIComponent(JSON.stringify({ kind: staged.kind, ...result, errors: result.errors.slice(0, 20) }))}`);
}
