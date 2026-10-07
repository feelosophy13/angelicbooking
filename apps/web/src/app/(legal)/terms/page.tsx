import type { Metadata } from "next";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <DocPage title="Terms of service" updated="October 7, 2026">
      <p>These terms govern use of Angelic Booking ("the service") by businesses and their staff. By creating an account you agree to them on behalf of your business.</p>
      <h2>Your account</h2>
      <p>You are responsible for keeping your login secure and for everything done under your business's accounts, including by staff you invite. Tell us promptly if you suspect unauthorised access.</p>
      <h2>Your data</h2>
      <p>Your business data belongs to you. You grant us the rights needed to store, process and display it to run the service. You are responsible for having the right to enter your clients' information and for honouring their messaging preferences.</p>
      <h2>Payments</h2>
      <p>Card payments are processed through your own Stripe account under Stripe's terms. We are not a party to transactions between you and your clients, and refunds, chargebacks and disputes are between you, your client and Stripe. Any platform fee is disclosed before you connect Stripe.</p>
      <h2>Acceptable use</h2>
      <p>Do not use the service to send unsolicited messages, to store data you are not entitled to hold, or to interfere with the service or other businesses using it.</p>
      <h2>Availability and changes</h2>
      <p>We aim to keep the service available at all times but do not guarantee uninterrupted access. We may change features with reasonable notice and will not remove your ability to export your data.</p>
      <h2>Liability</h2>
      <p>The service is provided as is. To the extent permitted by law, our liability for any claim is limited to the fees you paid for the service in the twelve months before the claim arose.</p>
      <h2>Ending the agreement</h2>
      <p>You can stop using the service and request deletion at any time. We may suspend accounts that breach these terms after giving notice where practical.</p>
      <h2>Contact</h2>
      <p>{process.env.SUPPORT_EMAIL ? <>Questions about these terms: <a href={`mailto:${process.env.SUPPORT_EMAIL}`}>{process.env.SUPPORT_EMAIL}</a>.</> : <>Questions about these terms: contact the operator of this service.</>}</p>
    </DocPage>
  );
}
