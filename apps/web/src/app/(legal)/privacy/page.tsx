import type { Metadata } from "next";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <DocPage title="Privacy policy" updated="October 17, 2026">
      <p>Angelic Booking ("the service") is scheduling, checkout and payroll software for salons and spas. Each business that uses the service controls its own clients' data. This page explains what we store and why.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>Account data</b>: your name, email address, password hash and optional two-factor secret.</li>
        <li><b>Business data</b> entered by a business: services, staff, schedules, clients, appointments, sales, notes and payroll settings.</li>
        <li><b>Client data</b> entered by clients when booking online or by the business at the desk: name, phone, email, appointment details, notes the business keeps about the visit, signed intake forms, before-and-after photos the business takes with the client's agreement, and messaging preferences.</li>
        <li><b>Messages</b>: the texts and emails a business sends its clients through the service (confirmations, reminders, and marketing the client opted into) and the client's replies.</li>
        <li><b>Payment data</b>: handled by Stripe. Card numbers never touch our servers; we store Stripe identifiers and the last four digits.</li>
        <li><b>Technical data</b>: IP address, browser type, and request logs used for security and rate limiting.</li>
      </ul>
      <h2>How it is used</h2>
      <p>To run the service: showing calendars, sending confirmations and reminders that clients opted into, taking payments through the business's own Stripe account, building reports and payroll. We do not sell personal data and do not use it for advertising.</p>
      <h2>Who can see it</h2>
      <p>Each business's data is isolated at the database level. Staff see only what their role allows. For its clients' data, the business is the controller and we process it on the business's instructions; a client who wants their record changed or removed should ask the business they booked with. Our subprocessors are Render (hosting, United States), Stripe (payments and billing), Twilio (text messages), Resend (email), Cloudflare (bot protection and picture storage) and Google (optional sign-in). We use no advertising or analytics trackers.</p>
      <h2>Texts</h2>
      <p>A business texts a client only after the client has agreed to receive texts, from a number registered to that business. Reply STOP to any text to stop them and HELP for help; message and data rates may apply. The business is responsible for the consent it collects.</p>
      <h2>Retention and deletion</h2>
      <p>Data is kept while the business account is active. A business owner can export clients and sales at any time, and can ask us to delete the account and its data. Clients can ask the business they booked with to remove their record.</p>
      <h2>Security</h2>
      <p>Connections are encrypted in transit, passwords are hashed, row-level security enforces tenant isolation, and two-factor authentication is available on every account.</p>
      <h2>Contact</h2>
      <p>{process.env.SUPPORT_EMAIL ? <>Questions about privacy: <a href={`mailto:${process.env.SUPPORT_EMAIL}`}>{process.env.SUPPORT_EMAIL}</a>.</> : <>Questions about privacy: contact the operator of this service.</>}</p>
    </DocPage>
  );
}
