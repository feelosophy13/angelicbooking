"use client";
import { useState } from "react";
import { Checkbox, MoneyInput } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveStoreSettings } from "./actions";

/** The shipping rate only matters while products are sold online; off, the stored rate is posted unchanged. */
export function StoreForm({ slug, giftCardsOnline, storeEnabled, shippingFlatCents, giftUrl, shopUrl }: { slug: string; giftCardsOnline: boolean; storeEnabled: boolean; shippingFlatCents: number; giftUrl: string; shopUrl: string }) {
  const [store, setStore] = useState(storeEnabled);
  const shipping = shippingFlatCents ? (shippingFlatCents / 100).toFixed(2) : "";
  return (
    <ActionForm action={saveStoreSettings}>
      <input type="hidden" name="slug" value={slug} />
      <Checkbox name="giftCardsOnline" defaultChecked={giftCardsOnline} label="Sell gift cards online" hint={<>Clients pick an amount, add a recipient and message, and the code is emailed when paid. <a className="underline" href={giftUrl} target="_blank" rel="noreferrer">{giftUrl}</a></>} />
      <Checkbox name="storeEnabled" checked={store} onChange={(e) => setStore(e.target.checked)} label="Sell products online" hint={<>Products marked “sell online” appear at <a className="underline" href={shopUrl} target="_blank" rel="noreferrer">{shopUrl}</a>. Orders show up under Sales with a pickup/shipping note.</>} />
      {store ? (
        <Field label="Flat shipping rate" name="shippingFlat" hint="Leave at 0 for pickup only."><MoneyInput name="shippingFlat" defaultValue={shipping} className="w-40" /></Field>
      ) : (
        <input type="hidden" name="shippingFlat" value={shipping} />
      )}
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </ActionForm>
  );
}
