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
