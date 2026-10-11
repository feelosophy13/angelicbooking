import { and, eq, or, sql } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { getSession } from "@/lib/session";
import { getClientSessionId } from "@/lib/client-session";

const PUBLIC_KINDS = new Set(["logo", "cover", "product", "package", "service", "category", "staff"]);
const PRIVATE_KINDS = new Set(["form", "signature"]);

/**
 * Serve an uploaded file. Branding, product, service and category images are public and immutable
 * (cacheable for a year). Form attachments and signatures are private: only a
 * member of the business or the client who signed may view them, never cached
 * by intermediaries. Anything else stored in `files` (e.g. staged imports) is
 * not served at all.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const row = await db.query.files.findFirst({ where: eq(schema.files.id, id) });
  if (!row) return new Response("Not found", { status: 404 });
  const isPublic = PUBLIC_KINDS.has(row.kind);
  if (!isPublic) {
    if (!PRIVATE_KINDS.has(row.kind)) return new Response("Not found", { status: 404 });
    if (!(await mayViewPrivate(row.businessId, row.id))) return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(row.size),
      "Cache-Control": isPublic ? "public, max-age=31536000, immutable" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(row.contentType === "image/svg+xml" ? { "Content-Security-Policy": "script-src 'none'" } : {}),
    },
  });
}

async function mayViewPrivate(businessId: string, fileId: string): Promise<boolean> {
  const session = await getSession();
  if (session) {
    const member = await db.query.member.findFirst({ where: and(eq(schema.member.organizationId, businessId), eq(schema.member.userId, session.user.id)), columns: { id: true } });
    if (member) return true;
  }
  const clientId = await getClientSessionId(businessId);
  if (!clientId) return false;
  // The client may see files attached to their own submissions (answers hold file ids; signatures are a column).
  const [hit] = await db
    .select({ id: schema.formSubmissions.id })
    .from(schema.formSubmissions)
    .where(and(eq(schema.formSubmissions.businessId, businessId), eq(schema.formSubmissions.clientId, clientId), or(eq(schema.formSubmissions.signatureFileId, fileId), sql`${schema.formSubmissions.answers}::text like ${"%" + fileId + "%"}`)))
    .limit(1);
  return Boolean(hit);
}
