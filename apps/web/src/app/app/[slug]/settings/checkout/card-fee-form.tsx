"use client";
import { useState } from "react";
import { Checkbox, Input, MoneyInput, Radio, RadioGroup } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import type { CardFeeSettings } from "@angelic/core";
import { saveCardFee } from "./actions";

/** The card fee: off, a surcharge or a convenience fee, then only that choice's fields, where it applies, and debit cards. */
export function CardFeeForm({ slug, current, currency, helcim }: { slug: string; current: CardFeeSettings; currency: string; helcim: boolean }) {
  const [type, setType] = useState(current.type);
  return (
    <ActionForm action={saveCardFee}>
      <input type="hidden" name="slug" value={slug} />
      <RadioGroup>
        <Radio name="type" value="off" checked={type === "off"} onChange={() => setType("off")} label="Off" hint="Card payments cost the client the same as cash." />
        <Radio name="type" value="surcharge" checked={type === "surcharge"} onChange={() => setType("surcharge")} label="Card surcharge" hint="A percent of the card payment, at most 3%." />
        <Radio name="type" value="convenience" checked={type === "convenience"} onChange={() => setType("convenience")} label="Convenience fee" hint="A flat amount per card payment." />
      </RadioGroup>
      {type === "off" ? null : (
        <div className="space-y-4 border-t border-stone-100 pt-4">
          {type === "surcharge" ? (
            <Field label="Surcharge" name="percent" hint="Up to 3%, and no more than card processing costs you.">
              <span className="relative block w-32">
                <Input name="percent" inputMode="decimal" defaultValue={current.bps ? String(current.bps / 100) : "3"} className="pr-8" />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-stone-500" aria-hidden>%</span>
              </span>
            </Field>
          ) : (
            <Field label="Convenience fee" name="amount" hint="Added once to each card payment.">
              <span className="block w-32"><MoneyInput name="amount" currency={currency.toUpperCase()} defaultValue={current.cents ? (current.cents / 100).toFixed(2) : ""} /></span>
            </Field>
          )}
          <RadioGroup legend="Add it to">
            <Checkbox name="desk" defaultChecked={current.type === "off" ? true : current.desk} label="Card payments at the desk" hint="Typed in, card on file and card reader. Not cards run on your own card machine." />
            <Checkbox name="online" defaultChecked={current.type === "off" ? true : current.online} label="Deposits paid at online booking" />
            <Checkbox name="store" defaultChecked={current.type === "off" ? true : current.store} label="The online store and gift cards" />
          </RadioGroup>
          <Checkbox
            name="debitExempt"
            defaultChecked={current.debitExempt}
            label="No fee on debit and prepaid cards"
            hint={helcim ? "Card brands don't allow a surcharge on debit cards. Helcim can't tell debit from credit before charging, so with this on, Helcim payments carry no fee." : "Card brands don't allow a surcharge on debit cards. Stripe tells debit from credit once the card is entered or tapped, before the fee is charged."}
          />
          <Checkbox name="acknowledge" required label="I've checked that my state allows this, and told my card processor and the card brands" hint="Required to turn the fee on. See the rules beside this form." />
        </div>
      )}
      <SubmitButton pendingText="Saving…">Save card fee</SubmitButton>
    </ActionForm>
  );
}
