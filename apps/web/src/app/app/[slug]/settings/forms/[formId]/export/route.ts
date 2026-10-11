import { requireAction } from "@/lib/tenant";
import { submissionsCsv } from "@/server/forms";
import { csvResponse } from "@/lib/csv";

/** Every submission of one form as CSV (one column per question). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; formId: string }> }) {
  const { slug, formId } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const out = await submissionsCsv(business.id, formId);
  if (!out) return new Response("Not found", { status: 404 });
  return csvResponse(`${out.form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-submissions.csv`, out.headers, out.rows);
}
