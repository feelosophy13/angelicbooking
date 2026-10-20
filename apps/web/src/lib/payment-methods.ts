/** How a payment method reads on screen and on receipts. */
const LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  card_on_file: "Card on file",
  terminal: "Card reader",
  external_card: "Card (own terminal)",
  other: "Other",
  gift_card: "Gift card",
  loyalty: "Points",
  store_credit: "Store credit",
};

export const paymentMethodLabel = (method: string) => LABELS[method] ?? method.replace(/_/g, " ");
