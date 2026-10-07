import type { Metadata } from "next";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <DocPage title="Privacy policy" updated="October 7, 2026">
      <p>Angelic Booking ("the service") is scheduling, checkout and payroll software for salons and spas. Each business that uses the service controls its own clients' data. This page explains what we store and why.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>Account data</b>: your name, email address, password hash and optional two-factor secret.</li>
        <li><b>Business data</b> entered by a business: services, staff, schedules, clients, appointments, sales, notes and payroll settings.</li>
        <li><b>Client data</b> entered by clients when booking online: name, phone, email, appointment details and messaging preferences.</li>
        <li><b>Payment data</b>: handled by Stripe. Card numbers never touch our servers; we store Stripe identifiers and the last four digits.</li>
        <li><b>Technical data</b>: IP address, browser type, and request logs used for security and rate limiting.</li>
      </ul>
      <h2>How it is used</h2>
      <p>To run the service: showing calendars, sending confirmations and reminders that clients opted into, taking payments through the business's own Stripe account, building reports and payroll. We do not sell personal data and do not use it for advertising.</p>
      <h2>Who can see it</h2>
      <p>Each business's data is isolated at the database level. Staff see only what their role allows. Our subprocessors are the hosting provider, Stripe (payments), and the email and SMS providers used to deliver messages.</p>
      <h2>Retention and deletion</h2>
      <p>Data is kept while the business account is active. A business owner can export clients and sales at any time, and can ask us to delete the account and its data. Clients can ask the business they booked with to remove their record.</p>
      <h2>Security</h2>
      <p>Connections are encrypted in transit, passwords are hashed, row-level security enforces tenant isolation, and two-factor authentication is available on every account.</p>
      <h2>Contact</h2>
      <p>{process.env.SUPPORT_EMAIL ? <>Questions about privacy: <a href={`mailto:${process.env.SUPPORT_EMAIL}`}>{process.env.SUPPORT_EMAIL}</a>.</> : <>Questions about privacy: contact the operator of this service.</>}</p>
    </DocPage>
  );
}
