"use client";
import { useState } from "react";
import { Input, Select } from "@/components/ui";
import { Field } from "@/components/form";

/** Time off or custom hours: the start and end times only appear for custom hours. */
export function OverrideFields() {
  const [kind, setKind] = useState<"off" | "hours">("off");
  return (
    <>
      <Field label="Type" name="kind">
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "off" | "hours")}>
          <option value="off">Time off</option>
          <option value="hours">Custom hours</option>
        </Select>
      </Field>
      {kind === "hours" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start" name="start" required><Input type="time" name="start" required className="px-2" /></Field>
          <Field label="End" name="end" required><Input type="time" name="end" required className="px-2" /></Field>
        </div>
      ) : null}
    </>
  );
}
