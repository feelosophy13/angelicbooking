import "server-only";
import { sql } from "drizzle-orm";
import { adminDb } from "./db";
import { requireAdmin } from "./admin";
import { revive } from "./rows";

export type AuditRow = { id: string; at: Date; actor: string; action: string; businessId: string | null; businessName: string | null; detail: Record<string, unknown> };

export async function listAudit(opts: { businessId?: string; limit?: number } = {}): Promise<AuditRow[]> {
  await requireAdmin();
  const where = opts.businessId ? sql`where a.business_id = ${opts.businessId}` : sql``;
  return revive<AuditRow>(await adminDb().execute(sql`
    select a.id, a.at, a.actor, a.action, a.business_id as "businessId", b.name as "businessName", a.detail
    from admin_audit_log a left join businesses b on b.id = a.business_id
    ${where} order by a.at desc limit ${opts.limit ?? 100}
  `), ["at"]);
}

const LABELS: Record<string, string> = {
  "pricing.default.update": "Changed the default pricing",
  "pricing.default.seed": "Default pricing set up from the old settings",
  "pricing.business.update": "Changed custom pricing",
  "tenant.suspend": "Suspended",
  "tenant.reactivate": "Reactivated",
  "tenant.comp": "Comped (no charge)",
  "tenant.uncomp": "Removed comp",
  "tenant.trial.extend": "Extended trial",
  "admin.password.reset": "Admin password reset",
};

export function actionLabel(action: string): string {
  return LABELS[action] ?? action;
}
