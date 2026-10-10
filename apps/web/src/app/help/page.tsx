import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Help" };

const faqs: { q: string; a: React.ReactNode }[] = [
  { q: "Where do my clients book?", a: <>Every business gets a booking page at <code>/book/your-business</code>. Copy the link from <b>Settings → Online booking</b> and put it on Instagram, Google, or your website. You can also point your own domain at it under <b>Settings → Domain</b>.</> },
  { q: "How do I add staff?", a: <>Go to <b>Staff → Add staff member</b>. Set their hours and the services they perform, then send them an invitation from the <b>Access</b> tab so they can sign in with their own login. Their role controls what they can see and do.</> },
  { q: "What do roles control?", a: <>Roles are permission sets. Owner, Manager, Provider and Front desk are built in; edit them or create your own under <b>Settings → Roles</b>. Providers only see their own appointments and pay by default.</> },
  { q: "How do I get paid?", a: <>Connect your own Stripe account under <b>Settings → Payments</b>. Card payments go straight to your Stripe balance. Cash, check and other methods are recorded on the ticket for reporting and payroll.</> },
  { q: "How does payroll work?", a: <>Set each staff member's pay rule on their <b>Pay</b> tab (commission, hourly, salary, or a mix). <b>Payroll</b> builds a period from closed sales, time entries and adjustments, and exports a workbook per provider.</> },
  { q: "Can I import from Vagaro or another system?", a: <>Yes. Export clients, services and appointments as CSV or Excel and upload them under <b>Settings → Import</b>. You map the columns once and preview before anything is written.</> },
  { q: "Do clients get reminders?", a: <>Confirmation, reminder, reschedule and cancellation emails/texts go out automatically to clients who opted in. Lead time and policy text live under <b>Settings → Notifications</b> and <b>Settings → Online booking</b>.</> },
  { q: "Something looks wrong on my calendar.", a: <>Double-check the business time zone under <b>Settings → Business profile</b> and the staff member's working hours. Appointments are stored in UTC and shown in your business time zone.</> },
  { q: "Can I take a deposit or a card when clients book online?", a: <>Yes, once Stripe is connected. Set a deposit on each service (it is charged at booking and comes off the bill at checkout) or tick <b>Require a card on file</b> under <b>Settings → Online booking</b> to save a card without charging it. Deposits are refunded automatically when a client cancels inside your cancellation window; staff can refund one from the appointment page.</> },
  { q: "How do standing appointments work?", a: <>On <b>New appointment</b>, choose <b>Repeat</b> (every 1–12 weeks) and the number of visits. Each visit is a normal appointment; dates that clash with time off or another booking are skipped and listed. From any visit you can cancel the rest of the series.</> },
  { q: "How do I run a class?", a: <>Give a service a <b>Group size</b> above 1, then schedule sessions under <b>Classes</b>. Clients pick a session on the booking page and seats are counted; the roster shows who is coming and lets you check people in.</> },
  { q: "Can I see my appointments in Google or Apple Calendar?", a: <>Each staff member's profile has a private <b>Calendar feed</b> link. Subscribe to it in Google Calendar, Apple Calendar or Outlook; reset the link to revoke it.</> },
  { q: "Intake forms and waivers?", a: <>Build them under <b>Settings → Forms</b> and attach them to services or to every visit. Clients get a link in their confirmation and reminder, sign on their phone, and the signed copy appears on their client page and the appointment.</> },
  { q: "How do reviews work?", a: <>After a visit is checked out, the client gets a one-tap rating request (email, or text if they have no email). Ratings land under <b>Reviews</b>; 4–5 star clients are invited to post on Google if you add your Google review link under <b>Settings → Review requests</b>.</> },
  { q: "Loyalty points, referrals and promo codes?", a: <>Turn on points under <b>Settings → Loyalty &amp; referrals</b>; clients earn on paid visits and redeem at checkout. Every client gets a referral code shown on their page and in their online account. Promo codes live under <b>Marketing → Promo codes</b> and work online and at checkout.</> },
  { q: "Can clients log in?", a: <>Yes: <b>My account</b> on the booking page signs them in with a code sent by email or text. They see upcoming and past visits, rebook in one tap, manage saved cards and see their points. Turn it off under <b>Settings → Online booking</b>.</> },
  { q: "Marketing emails and texts?", a: <><b>Marketing → Campaigns</b> sends a one-off message to a filtered list (opted-out clients are skipped; every email has an unsubscribe link and texts say how to stop). <b>Automations</b> handle birthday, we-miss-you and rebook messages.</> },
  { q: "Selling online and tracking stock?", a: <>Under <b>Settings → Online store</b> you can sell gift cards (emailed when paid) and products for pickup or flat-rate shipping. On each product, turn on <b>Track stock</b> to count units, get low-stock warnings and see stock value on the Sales report.</> },
  { q: "Do memberships renew automatically?", a: <>Once a client has a saved card, open their client page and choose <b>Auto-renew with this card</b> on the membership. The card is charged at the end of each period through your own Stripe account; failures pause the membership until the card is updated.</> },
];

export default function HelpPage() {
  return (
    <DocPage title="Help">
      <p>Quick answers for owners and staff. If you are new, start with the setup checklist on your calendar: it walks through services, staff, and online booking.</p>
      {faqs.map((f) => (
        <section key={f.q}>
          <h2>{f.q}</h2>
          <p>{f.a}</p>
        </section>
      ))}
      <h2>Keyboard shortcuts</h2>
      <ul>
        <li><kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> — search clients, appointments and pages</li>
        <li>Drag an appointment on the calendar to move it; click an empty slot to book there</li>
        <li>Hover an appointment to check the client in or mark them completed</li>
      </ul>
      <h2>Still stuck?</h2>
      <p>{process.env.SUPPORT_EMAIL ? <>Email <a href={`mailto:${process.env.SUPPORT_EMAIL}`}>{process.env.SUPPORT_EMAIL}</a> and include your business name.</> : <>Contact the person who set up your account.</>} See also our <Link href="/privacy">privacy policy</Link> and <Link href="/terms">terms</Link>.</p>
    </DocPage>
  );
}
