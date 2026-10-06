/** Target fields per import kind and the header synonyms we auto-detect. */
export const IMPORT_KINDS = ["clients", "services", "appointments"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  synonyms: string[];
}

export const FIELDS: Record<ImportKind, FieldSpec[]> = {
  clients: [
    { key: "firstName", label: "First name", required: true, synonyms: ["first name", "firstname", "first", "customer first name", "client first name"] },
    { key: "lastName", label: "Last name", synonyms: ["last name", "lastname", "last", "customer last name", "client last name", "surname"] },
    { key: "fullName", label: "Full name (if no first/last)", synonyms: ["customer", "customer name", "client", "client name", "name", "full name"] },
    { key: "email", label: "Email", synonyms: ["email", "e-mail", "email address", "customer email"] },
    { key: "phone", label: "Mobile phone", synonyms: ["mobile", "mobile phone", "cell", "cell phone", "phone", "phone number", "customer phone", "primary phone"] },
    { key: "notes", label: "Notes", synonyms: ["notes", "note", "customer notes", "client notes", "comments"] },
    { key: "birthday", label: "Birthday", synonyms: ["birthday", "birth date", "dob", "date of birth"] },
    { key: "smsOptIn", label: "SMS opt-in", synonyms: ["sms", "text opt in", "sms opt-in", "receive text", "text messages", "opt in sms"] },
    { key: "emailOptIn", label: "Email opt-in", synonyms: ["email opt in", "email opt-in", "receive email", "email marketing"] },
  ],
  services: [
    { key: "name", label: "Service name", required: true, synonyms: ["service", "service name", "name", "service/product/gc/package/membership/class", "item"] },
    { key: "category", label: "Category", synonyms: ["category", "service category", "department"] },
    { key: "durationMin", label: "Duration (minutes)", required: true, synonyms: ["duration", "duration (min)", "duration minutes", "minutes", "length", "time"] },
    { key: "price", label: "Price", required: true, synonyms: ["price", "amount", "cost", "service price", "rate"] },
    { key: "description", label: "Description", synonyms: ["description", "details"] },
    { key: "gapMin", label: "Processing time (min)", synonyms: ["processing time", "processing", "gap", "process time"] },
  ],
  appointments: [
    { key: "date", label: "Appointment date", required: true, synonyms: ["appointment date", "date", "appt date", "start date"] },
    { key: "time", label: "Start time", synonyms: ["start time", "time", "appointment time", "start"] },
    { key: "customer", label: "Customer name", required: true, synonyms: ["customer", "customer name", "client", "client name", "name"] },
    { key: "phone", label: "Customer phone", synonyms: ["phone", "mobile", "customer phone", "cell"] },
    { key: "email", label: "Customer email", synonyms: ["email", "customer email"] },
    { key: "service", label: "Service", required: true, synonyms: ["service", "service name", "service/product/gc/package/membership/class", "item"] },
    { key: "staff", label: "Staff member", required: true, synonyms: ["service provider", "provider", "employee", "staff", "stylist", "sold by", "booked with"] },
    { key: "durationMin", label: "Duration (minutes)", synonyms: ["duration", "duration (min)", "minutes", "length"] },
    { key: "status", label: "Status", synonyms: ["status", "appointment status"] },
    { key: "notes", label: "Notes", synonyms: ["notes", "note", "comments"] },
    { key: "price", label: "Price", synonyms: ["price", "amount", "service price"] },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Guess a header for each target field. Exact synonym match first, then substring. */
export function autoMap(kind: ImportKind, headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const normalized = headers.map((h) => ({ h, n: norm(h) }));
  for (const f of FIELDS[kind]) {
    const syns = f.synonyms.map(norm);
    let hit = normalized.find((x) => !used.has(x.h) && syns.includes(x.n));
    if (!hit) hit = normalized.find((x) => !used.has(x.h) && syns.some((s) => s.length > 3 && x.n.includes(s)));
    if (hit) {
      out[f.key] = hit.h;
      used.add(hit.h);
    }
  }
  return out;
}

export function parseBool(v: string | undefined): boolean | null {
  if (v == null || v.trim() === "") return null;
  const s = v.trim().toLowerCase();
  if (["yes", "y", "true", "1", "on", "opted in", "subscribed"].includes(s)) return true;
  if (["no", "n", "false", "0", "off", "opted out", "unsubscribed"].includes(s)) return false;
  return null;
}

/** "45", "45 min", "1h 15m", "1:15", "75 minutes" → minutes */
export function parseDuration(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  const hm = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  let total = 0;
  let matched = false;
  const h = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/.exec(s);
  if (h) {
    total += Math.round(Number(h[1]) * 60);
    matched = true;
  }
  const m = /(\d+)\s*(m|min|mins|minute|minutes)\b/.exec(s);
  if (m) {
    total += Number(m[1]);
    matched = true;
  }
  if (matched) return total;
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Accepts MM/DD/YYYY, YYYY-MM-DD, M/D/YY, ISO datetimes, "Oct 6, 2026". Returns YYYY-MM-DD. */
export function parseDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (us) {
    const y = us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    return `${y}-${String(us[1]).padStart(2, "0")}-${String(us[2]).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/** "9:30 AM", "14:05", "2026-10-06T09:30:00" → "HH:mm" */
export function parseTime(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  const isoT = /T(\d{2}):(\d{2})/.exec(s);
  if (isoT) return `${isoT[1]}:${isoT[2]}`;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1]! };
}
