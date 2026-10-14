"use client";
import { useState } from "react";
import { Input, MoneyInput, Select } from "@/components/ui";
import { Field } from "@/components/form";

type Mode = "none" | "flat" | "percent" | "full";

/** What booking this service online collects up front: nothing, a flat deposit, a percent of the price, or the full price. */
export function OnlinePaymentField({ type, depositCents, percent, currency }: { type: string; depositCents: number; percent: number; currency: string }) {
  const [mode, setMode] = useState<Mode>(type === "full" ? "full" : type === "percent" && percent > 0 ? "percent" : type === "flat" && depositCents > 0 ? "flat" : "none");
  return (
    <>
      <input type="hidden" name="depositType" value={mode === "none" ? "flat" : mode} />
      <Field label="Payment when booking online" name="depositMode" hint="Needs Stripe. What is paid comes off the bill at checkout and is refunded on cancellations inside the policy window.">
        <Select name="depositMode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="none">Nothing up front</option>
          <option value="flat">A fixed deposit</option>
          <option value="percent">A percent of the price</option>
          <option value="full">Full payment</option>
        </Select>
      </Field>
      {mode === "flat" ? <Field label="Deposit" name="deposit"><MoneyInput name="deposit" currency={currency} defaultValue={depositCents ? (depositCents / 100).toFixed(2) : ""} /></Field> : null}
      {mode === "percent" ? <Field label="Deposit percent" name="depositPercent" hint="Of the price this stylist charges."><Input name="depositPercent" type="number" min={1} max={100} defaultValue={percent || 25} /></Field> : null}
    </>
  );
}
