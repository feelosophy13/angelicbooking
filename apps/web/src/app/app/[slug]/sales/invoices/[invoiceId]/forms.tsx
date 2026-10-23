"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
import { Button, Input, MoneyInput, Radio, RadioGroup } from "@/components/ui";
import { recordPaymentAction, sendInvoiceAction, voidInvoiceAction } from "../actions";

/** Email and/or text the invoice's link; the client's own email and mobile are filled in. */
export function SendInvoiceForm({ slug, invoiceId, email, phone, sent }: { slug: string; invoiceId: string; email: string; phone: string; sent: boolean }) {
  return (
    <ActionForm action={sendInvoiceAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Field label="Email" name="email"><Input name="email" type="email" defaultValue={email} placeholder="client@example.com" /></Field>
      <Field label="Text to mobile" name="phone" hint="Leave either one blank to skip it."><Input name="phone" type="tel" defaultValue={phone} /></Field>
      <SubmitButton className="w-full" pendingText="Sending…">{sent ? "Send again" : "Send invoice"}</SubmitButton>
    </ActionForm>
  );
}

/** Cash or a check, for part or all of what is owed. */
export function RecordPaymentForm({ slug, invoiceId, currency, balance }: { slug: string; invoiceId: string; currency: string; balance: string }) {
  const [method, setMethod] = useState<"cash" | "check">("check");
  return (
    <ActionForm action={recordPaymentAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <RadioGroup inline>
        <Radio name="method" value="check" checked={method === "check"} onChange={() => setMethod("check")} label="Check" />
        <Radio name="method" value="cash" checked={method === "cash"} onChange={() => setMethod("cash")} label="Cash" />
      </RadioGroup>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount" name="amount"><MoneyInput name="amount" currency={currency} defaultValue={balance} /></Field>
        {method === "check" ? <Field label="Check number" name="checkNumber"><Input name="checkNumber" inputMode="numeric" maxLength={30} /></Field> : null}
      </div>
      <SubmitButton variant="secondary" className="w-full" pendingText="Recording…">Record payment</SubmitButton>
    </ActionForm>
  );
}

export function VoidInvoiceForm({ slug, invoiceId }: { slug: string; invoiceId: string }) {
  return (
    <ActionForm action={voidInvoiceAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <ConfirmSubmit title="Void this invoice?" body="The client's link will say it is void and no reminders go out. This can't be undone." confirmLabel="Void invoice" variant="ghost" className="text-red-700">Void invoice</ConfirmSubmit>
    </ActionForm>
  );
}

export function CopyLinkButton({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={() => void navigator.clipboard.writeText(url).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
    >
      {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {done ? "Copied" : "Copy link"}
    </Button>
  );
}
