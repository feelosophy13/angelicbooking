"use client";
import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { GUEST_RELATIONS } from "@/lib/group-guests";

/** The guests planned on the page (lib/group-guests) and, for a signed-in client, the family they can book for. */
export type GuestFormInfo = { encoded: string; people: { label: string }[]; family: { id: string; name: string; relation: string }[] };

/**
 * One block per guest: who they are. A signed-in client picks a family member or types a new person; a name is enough, and a phone or
 * email (optional) gets the guest their own confirmation and reminders. Field names are guest0FirstName… (guestDetailsFrom).
 */
export function GuestFields({ guests }: { guests: GuestFormInfo }) {
  return (
    <>
      <input type="hidden" name="guests" value={guests.encoded} />
      {guests.people.map((p, i) => <GuestBlock key={i} index={i} label={p.label} family={guests.family} />)}
    </>
  );
}

function GuestBlock({ index: i, label, family }: { index: number; label: string; family: GuestFormInfo["family"] }) {
  const [pick, setPick] = useState("");
  return (
    <fieldset className="space-y-3 rounded-lg border border-stone-200 p-3">
      <legend className="px-1 text-sm font-medium text-stone-800">{label}</legend>
      {family.length ? (
        <Field label="Who is this for?">
          <Select name={`guest${i}Family`} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Someone else</option>
            {family.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
        </Field>
      ) : null}
      {pick ? null : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" required><Input name={`guest${i}FirstName`} required autoComplete="off" /></Field>
            <Field label="Last name"><Input name={`guest${i}LastName`} autoComplete="off" /></Field>
          </div>
          <Field label="They are">
            <Select name={`guest${i}Relation`} defaultValue="friend">
              {GUEST_RELATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Their mobile" hint="Optional. For their own confirmation and reminders."><Input name={`guest${i}Phone`} type="tel" autoComplete="off" /></Field>
            <Field label="Their email" hint="Optional."><Input name={`guest${i}Email`} type="email" autoComplete="off" /></Field>
          </div>
        </>
      )}
    </fieldset>
  );
}
