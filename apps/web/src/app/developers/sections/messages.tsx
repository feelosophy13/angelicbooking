import { Endpoint } from "../doc-kit";

/** The delivery log, clients' text replies and texting a client. Mounted by the developers page. */
export function MessagesDocs() {
  return (
    <>
      <h2>Messages</h2>
      <p>Every text and email the system sends to clients is a row in the delivery log: confirmations, reminders, campaigns, automations and staff replies. Provider references and keys are never shown.</p>
      <Endpoint method="GET" path="/notifications" scope="messages:read">
        <p>The delivery log, newest first. Query: <code>channel</code> (<code>email</code> or <code>sms</code>), <code>status</code> (<code>queued</code>, <code>sending</code>, <code>sent</code>, <code>failed</code>, <code>skipped</code>, <code>cancelled</code>), <code>client_id</code>, <code>campaign_id</code>, <code>template</code> (for example <code>campaign</code>, <code>staff_reply</code>), <code>from</code> and <code>to</code> (ISO times, on when the message was created), <code>limit</code>, <code>page</code>.</p>
        <p>Fields: <code>id</code>, <code>channel</code>, <code>template</code>, <code>status</code>, <code>recipient</code>, <code>subject</code>, <code>body</code> (an email&apos;s body is its HTML), <code>client_id</code>, <code>appointment_id</code>, <code>campaign_id</code>, <code>attempts</code>, <code>error</code>, <code>scheduled_at</code>, <code>sent_at</code>, <code>created_at</code>.</p>
      </Endpoint>
      <Endpoint method="GET" path="/notifications/{id}" scope="messages:read"><p>One message.</p></Endpoint>
      <Endpoint method="POST" path="/notifications/{id}/resend" scope="messages:write"><p>Try a failed or skipped message again now (the app&apos;s Resend button). No body. Returns <code>sent</code>, <code>failed</code>, <code>skipped</code> (0 or 1 each) and the message with its new status. Any other status answers <code>409</code>.</p></Endpoint>
      <Endpoint method="GET" path="/messages" scope="messages:read"><p>Texts clients sent to your business&apos;s number, newest first. Query: <code>client_id</code>, <code>unread=true</code>, <code>limit</code>, <code>page</code>. Fields: <code>id</code>, <code>client_id</code> (null when the number is not a known client), <code>client_name</code>, <code>from_number</code>, <code>to_number</code>, <code>body</code>, <code>received_at</code>, <code>read_at</code>. A client who replies STOP is opted out of texts automatically.</p></Endpoint>
      <Endpoint method="GET" path="/clients/{id}/messages" scope="messages:read"><p>The text conversation with one client, oldest first: <code>direction</code> (<code>inbound</code> or <code>outbound</code>), <code>body</code>, <code>at</code>, <code>status</code>. Optional <code>limit</code> (up to 100).</p></Endpoint>
      <Endpoint method="POST" path="/clients/{id}/messages" scope="messages:write">
        <p>Text a client, as the reply box on the client page does. Body: <code>body</code> (1 to 1000 characters). The text is queued and delivered right away; check <code>/notifications</code> (template <code>staff_reply</code>) for the outcome. Answers <code>201</code>.</p>
        <p><code>409</code> with the app&apos;s message, and nothing queued, when the client has no mobile number or has opted out of texts.</p>
      </Endpoint>
    </>
  );
}
