"use client";
import { useState } from "react";
import { Input, Select } from "@/components/ui";
import { Field } from "@/components/form";

/** Business type with the EIN beside it; a sole proprietor has no EIN, so the box goes away. */
export function BusinessTypeFields({ type, ein }: { type: string; ein: string }) {
  const [kind, setKind] = useState(type);
  return (
    <>
      <Field label="Business type" name="businessType">
        <Select name="businessType" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="PRIVATE_PROFIT">Private company (LLC, Inc., partnership)</option>
          <option value="SOLE_PROPRIETOR">Sole proprietor (no EIN)</option>
          <option value="PUBLIC_PROFIT">Publicly traded company</option>
          <option value="NON_PROFIT">Non-profit</option>
          <option value="GOVERNMENT">Government</option>
        </Select>
      </Field>
      {kind !== "SOLE_PROPRIETOR" ? (
        <Field label="EIN" name="businessRegistrationNumber" hint="9 digits, e.g. 12-3456789." required><Input name="businessRegistrationNumber" defaultValue={ein} placeholder="12-3456789" /></Field>
      ) : null}
    </>
  );
}
