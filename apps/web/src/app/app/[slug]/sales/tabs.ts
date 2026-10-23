/** Sales & checkout's two lists: tickets (the desk) and invoices (bills sent to pay online). */
export const salesTabs = (slug: string) => [
  { href: `/app/${slug}/sales`, label: "Tickets" },
  { href: `/app/${slug}/sales/invoices`, label: "Invoices" },
];
