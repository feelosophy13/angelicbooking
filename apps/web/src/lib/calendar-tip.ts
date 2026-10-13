/** What the calendar's hover tooltip shows for one appointment, block or class. Built on the server, drawn by the grid. */

export type CalTip = {
  kind: "visit" | "block" | "class";
  /** The client's name, the reason for a block, or the class name. */
  heading: string;
  /** Phone for a visit, seats for a class. */
  sub: string | null;
  status: string;
  tags: string[];
  /** Every service on the visit, with who does it and when (a long service's processing segments are merged). */
  lines: { service: string; staff: string; startMin: number; endMin: number; price: string | null }[];
  total: string | null;
  /** Short facts: how it was booked, deposit, forms due. */
  facts: string[];
  notes: string | null;
};

export type TipItem = {
  appointmentId: string;
  serviceName: string;
  staffName: string;
  startMin: number;
  endMin: number;
  priceCents: number;
  status: string;
  kind?: string;
  clientName: string | null;
  clientPhone?: string | null;
  clientTags?: string[] | null;
  source?: string | null;
  depositCents?: number | null;
  depositStatus?: string | null;
  notes: string | null;
  classSessionId?: string | null;
  seats?: { booked: number; capacity: number } | null;
};

const STATUS_LABEL: Record<string, string> = {
  booked: "Booked",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  in_progress: "In progress",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
  class: "Class",
};
const SOURCE_LABEL: Record<string, string> = { online: "Booked online", staff: "Booked by staff", import: "Imported" };
const baseName = (n: string) => n.replace(/ \(finish\)$/, "");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** `items` are every row of one appointment in the visible range, in start order. */
export function buildTip(items: TipItem[], ctx: { money: (cents: number) => string; formsDue: boolean }): CalTip {
  const first = items[0]!;
  const notes = first.notes?.trim() ? clip(first.notes.trim(), 180) : null;
  if (first.kind === "block") {
    const reason = first.serviceName.replace(/^Blocked( · )?/, "").trim();
    return { kind: "block", heading: reason || "Blocked time", sub: null, status: "Blocked time", tags: [], lines: [{ service: "Blocked time", staff: first.staffName, startMin: first.startMin, endMin: first.endMin, price: null }], total: null, facts: [], notes: null };
  }
  if (first.classSessionId) {
    const seats = first.seats ? `${first.seats.booked} of ${first.seats.capacity} seats taken` : null;
    return { kind: "class", heading: first.serviceName, sub: seats, status: STATUS_LABEL[first.status] ?? "Class", tags: [], lines: [{ service: first.serviceName, staff: first.staffName, startMin: first.startMin, endMin: first.endMin, price: null }], total: null, facts: [], notes };
  }
  // A service with a processing gap is two rows ("Lash Lift", "Lash Lift (finish)"): show one line.
  const merged: { service: string; staff: string; startMin: number; endMin: number; cents: number }[] = [];
  for (const i of items) {
    const name = baseName(i.serviceName);
    const prev = merged.find((l) => l.service === name && l.staff === i.staffName);
    if (prev) {
      prev.startMin = Math.min(prev.startMin, i.startMin);
      prev.endMin = Math.max(prev.endMin, i.endMin);
      prev.cents += i.priceCents;
    } else merged.push({ service: name, staff: i.staffName, startMin: i.startMin, endMin: i.endMin, cents: i.priceCents });
  }
  const lines: CalTip["lines"] = merged.map((l) => ({ service: l.service, staff: l.staff, startMin: l.startMin, endMin: l.endMin, price: l.cents ? ctx.money(l.cents) : null }));
  const totalCents = items.reduce((s, i) => s + i.priceCents, 0);
  const facts: string[] = [];
  if (first.source && SOURCE_LABEL[first.source]) facts.push(SOURCE_LABEL[first.source]!);
  if (first.depositCents && first.depositCents > 0) facts.push(`Deposit ${ctx.money(first.depositCents)}${first.depositStatus === "paid" ? " paid" : first.depositStatus && first.depositStatus !== "none" ? ` ${first.depositStatus}` : ""}`);
  if (ctx.formsDue) facts.push("Forms due");
  return {
    kind: "visit",
    heading: first.clientName ?? "Walk-in",
    sub: first.clientPhone ?? null,
    status: STATUS_LABEL[first.status] ?? first.status.replace("_", " "),
    tags: (first.clientTags ?? []).slice(0, 4),
    lines,
    total: lines.length > 1 && totalCents > 0 ? ctx.money(totalCents) : null,
    facts,
    notes,
  };
}
