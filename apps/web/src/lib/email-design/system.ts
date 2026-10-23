/**
 * The automatic emails a business can redesign (Settings → Email designs). Each keeps its own content (the visit details and manage
 * link, the rating stars, the receipt) as a required "Message details" block; the owner adds a heading, pictures, text and buttons
 * around it. An empty subject keeps the usual one (which names the receipt number, the amount or the order). With no custom design the email is sent exactly as before (lib/notify/templates.ts).
 */
import type { EmailDesign, FieldScope } from "./index";

export const SYSTEM_EMAIL_KEYS = ["confirmation", "reminder", "rescheduled", "cancellation", "forms_nudge", "review_request", "receipt", "gift_card", "order", "invoice"] as const;
export type SystemEmailKey = (typeof SYSTEM_EMAIL_KEYS)[number];

export const isSystemEmailKey = (k: string): k is SystemEmailKey => (SYSTEM_EMAIL_KEYS as readonly string[]).includes(k);

export const SYSTEM_EMAILS: Record<SystemEmailKey, { label: string; when: string; scopes: FieldScope[]; subject: string; heading: string; core: string }> = {
  confirmation: { label: "Booking confirmation", when: "Right after a visit is booked.", scopes: ["all", "appointment"], subject: "Confirmed: {service} at {business}", heading: "You're booked, {first_name}!", core: "The visit's date, service and staff, any deposit, forms still due, “Before your visit” notes, the Manage button and your cancellation policy." },
  reminder: { label: "Appointment reminder", when: "Before the visit, from the Appointment reminder automation.", scopes: ["all", "appointment"], subject: "Reminder: {service} {when}", heading: "See you soon, {first_name}", core: "The visit's date, service and staff, forms still due, “Before your visit” notes, the Manage button and your cancellation policy." },
  rescheduled: { label: "Appointment moved", when: "When a visit moves to a new time.", scopes: ["all", "appointment"], subject: "Updated: {service} at {business}", heading: "Your appointment was moved", core: "The new date, service and staff, the Manage button and your cancellation policy." },
  cancellation: { label: "Cancellation", when: "When a visit is cancelled.", scopes: ["all", "appointment"], subject: "Cancelled: {service} at {business}", heading: "Your appointment was cancelled", core: "Which visit was cancelled, and how to book again." },
  forms_nudge: { label: "Forms still due", when: "The morning of a visit when a form isn't done yet.", scopes: ["all", "appointment"], subject: "Before your visit today: a form to complete", heading: "See you soon, {first_name}", core: "The link to the forms still due." },
  review_request: { label: "Review request", when: "After a completed visit, from the review request automation.", scopes: ["all", "appointment", "review"], subject: "How was your visit to {business}?", heading: "Thanks for coming in, {first_name}!", core: "The five rating stars and the “Don't ask me again” link." },
  receipt: { label: "Receipt", when: "When a receipt is emailed from a sale.", scopes: ["all"], subject: "", heading: "{business}", core: "The receipt: what was bought, tax, tip, total and how it was paid, and your receipt footer." },
  gift_card: { label: "Gift card", when: "When a gift card bought online is sent to its recipient.", scopes: ["all"], subject: "", heading: "You've got a gift card!", core: "The amount, the code, the sender's message and a Book button." },
  invoice: { label: "Invoice", when: "When an invoice is sent to a client, and its reminders before and after the due date.", scopes: ["all"], subject: "", heading: "You have an invoice", core: "The invoice's lines, total, what was paid, the deposit due now, your note and the Pay button." },
  order: { label: "Online store order", when: "After an order in the online store.", scopes: ["all"], subject: "", heading: "Order received", core: "The items ordered, the total, and pickup or shipping details." },
};

/** Where a customization starts: the default heading above the message's own content. */
export function systemStarter(key: SystemEmailKey): EmailDesign {
  const s = SYSTEM_EMAILS[key];
  return { subject: s.subject, preheader: "", blocks: [{ id: "h1", type: "heading", text: s.heading }, { id: "core", type: "core" }] };
}
