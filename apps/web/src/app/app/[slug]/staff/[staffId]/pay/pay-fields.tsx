"use client";
import { useState } from "react";
import { Input, Select, MoneyInput } from "@/components/ui";
import { Field } from "@/components/form";

type Pay = { payType: "commission" | "hourly" | "salary"; mainCommissionBps: number; productCommissionBps: number; ccTipFeeBps: number; hourlyRateCents: number; salaryPerPeriodCents: number; overtimeOverride: boolean | null; taxDeductionCents: number | null; taxDeductionBps: number | null };

/**
 * Pay settings shown one model at a time: pick how the person is paid and only
 * the matching fields appear. Everything else sits under "More options". Hidden
 * fields stay in the form so saving never drops a value.
 */
export function PayFields({ p }: { p: Pay }) {
  const [type, setType] = useState<Pay["payType"]>(p.payType);
  const [hasBase, setHasBase] = useState(p.hourlyRateCents > 0);
  const [more, setMore] = useState(false);
  const w2 = type !== "commission";
  const hide = (on: boolean) => (on ? "" : "hidden");
  const BLURB: Record<Pay["payType"], string> = {
    commission: "A percentage of the services they perform, paid as a 1099 contractor. Tips are theirs less the card-tip fee.",
    hourly: "Rate × clocked hours as a W-2 employee. Add a service percentage if they also earn commission.",
    salary: "A flat amount per pay period as a W-2 employee. Add a service percentage if they also earn commission.",
  };
  return (
    <div className="space-y-4">
      <Field label="How are they paid?" name="payType">
        <Select name="payType" value={type} onChange={(e) => setType(e.target.value as Pay["payType"])}>
          <option value="commission">Commission (1099)</option>
          <option value="hourly">Hourly (W-2)</option>
          <option value="salary">Salary (W-2)</option>
        </Select>
      </Field>
      <p className="text-sm text-stone-600">{BLURB[type]}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Service commission %" name="mainCommissionPct" hint={type === "commission" ? "Of main-service revenue." : "Optional, on top of wages."} className={hide(true)}>
          <Input name="mainCommissionPct" type="number" step="0.5" min={0} max={100} defaultValue={(p.mainCommissionBps / 100).toString()} />
        </Field>
        <Field label="Hourly rate ($)" name="hourlyRate" hint={type === "commission" ? "Optional guaranteed base on clocked hours." : "Paid on time-clock hours."} className={hide(type !== "salary")}>
          <MoneyInput name="hourlyRate" defaultValue={p.hourlyRateCents ? (p.hourlyRateCents / 100).toFixed(2) : ""} onChange={(e) => setHasBase(e.target.value.trim() !== "")} />
        </Field>
        <Field label="Salary per pay period ($)" name="salaryPerPeriod" className={hide(type === "salary")}>
          <MoneyInput name="salaryPerPeriod" defaultValue={p.salaryPerPeriodCents ? (p.salaryPerPeriodCents / 100).toFixed(2) : ""} />
        </Field>
        <Field label="Overtime" name="overtimeOverride" className={hide(type === "hourly" || (type === "commission" && hasBase))}>
          <Select name="overtimeOverride" defaultValue={p.overtimeOverride == null ? "default" : p.overtimeOverride ? "yes" : "no"}>
            <option value="default">Follow the payroll run</option>
            <option value="yes">Always 1.5× over 40 h</option>
            <option value="no">Never (straight time)</option>
          </Select>
        </Field>
      </div>
      <button type="button" onClick={() => setMore((m) => !m)} className="text-sm text-brand-700 hover:underline">{more ? "Fewer options" : "More options"}</button>
      <div className={`grid gap-4 sm:grid-cols-2 ${hide(more)}`}>
        <Field label="Product / package commission %" name="productCommissionPct" hint="On retail and packages they sell.">
          <Input name="productCommissionPct" type="number" step="0.5" min={0} max={100} defaultValue={(p.productCommissionBps / 100).toString()} />
        </Field>
        <Field label="Fee on card tips %" name="ccTipFeePct" hint="Deducted from tips paid by card.">
          <Input name="ccTipFeePct" type="number" step="0.1" min={0} max={100} defaultValue={(p.ccTipFeeBps / 100).toString()} />
        </Field>
        <Field label="Tax withholding ($ per period)" name="taxDeductionAmount" hint="Leave blank for the accountant." className={hide(w2)}><MoneyInput name="taxDeductionAmount" defaultValue={p.taxDeductionCents != null ? (p.taxDeductionCents / 100).toFixed(2) : ""} /></Field>
        <Field label="or withholding %" name="taxDeductionPct" className={hide(w2)}><Input name="taxDeductionPct" type="number" step="0.1" min={0} max={60} defaultValue={p.taxDeductionBps != null ? (p.taxDeductionBps / 100).toString() : ""} /></Field>
      </div>
    </div>
  );
}
