import { MEMBERSHIP_CADENCES } from "@angelic/core";
import { Input, Select, Textarea } from "@/components/ui";
import { Field } from "@/components/form";

type Plan = { name: string; priceCents: number; interval: string; intervalCount: number; includedServiceId: string | null; includedSessions: number; rolloverCap: number; cycleCount: number | null; discountBps: number; description: string | null };

/** The shared body of the new / edit membership plan forms. */
export function PlanFields({ plan, services }: { plan?: Plan; services: { id: string; name: string }[] }) {
  const cadence = plan ? `${plan.interval}:${plan.intervalCount}` : "month:1";
  return (
    <>
      <Field label="Name" name="name" required><Input name="name" defaultValue={plan?.name} required placeholder="Lash Club" autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price" name="price" required><Input name="price" inputMode="decimal" defaultValue={plan ? (plan.priceCents / 100).toFixed(2) : undefined} required placeholder="99" /></Field>
        <Field label="Billed" name="cadence" required>
          <Select name="cadence" defaultValue={cadence}>{MEMBERSHIP_CADENCES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select>
        </Field>
      </div>
      <Field label="Included service" name="includedServiceId"><Select name="includedServiceId" defaultValue={plan?.includedServiceId ?? ""}><option value="">None</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sessions per billing period" name="includedSessions"><Input name="includedSessions" type="number" min={0} defaultValue={plan?.includedSessions ?? 1} /></Field>
        <Field label="Unused sessions that carry over" name="rolloverCap" hint="0 means they expire at renewal"><Input name="rolloverCap" type="number" min={0} max={99} defaultValue={plan?.rolloverCap ?? 0} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Discount on other services (%)" name="discountPct"><Input name="discountPct" type="number" min={0} max={100} defaultValue={plan ? plan.discountBps / 100 : 0} /></Field>
        <Field label="Ends after (billing periods)" name="cycleCount" hint="0 means ongoing until cancelled"><Input name="cycleCount" type="number" min={0} max={120} defaultValue={plan?.cycleCount ?? 0} /></Field>
      </div>
      <Field label="Description" name="description"><Textarea name="description" rows={4} defaultValue={plan?.description ?? ""} /></Field>
    </>
  );
}
