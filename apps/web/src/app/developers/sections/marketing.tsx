import { Endpoint } from "../doc-kit";

/** Campaigns, promo codes and automations. Mounted by the developers page. */
export function MarketingDocs() {
  return (
    <>
      <h2>Campaigns</h2>
      <p>A campaign is a one-off email or text to the clients who match an audience. Creating or editing one never sends anything: sending is its own call, and it works once.</p>
      <p>
        The <code>audience</code> object (all fields optional, all <code>null</code> or false when unset): <code>visited_within_days</code> and <code>lapsed_days</code> (whole days, 1 to 3650), <code>service_id</code>, <code>staff_id</code>,
        <code> location_id</code>, <code>tag</code> (up to 40 characters), <code>never_visited</code> (true or false). Only clients who opted in to that channel and have an email address or phone number are included. Ids must belong to your business, otherwise <code>404</code>.
      </p>
      <Endpoint method="GET" path="/campaigns" scope="marketing:read"><p>Newest first. Optional <code>status</code> (<code>draft</code> or <code>sent</code>), <code>limit</code>, <code>page</code>.</p></Endpoint>
      <Endpoint method="GET" path="/campaigns/{id}" scope="marketing:read"><p>One campaign: <code>name</code>, <code>channel</code>, <code>subject</code>, <code>body</code>, <code>audience</code>, <code>status</code>, <code>recipient_count</code>, <code>sent_at</code>. A sent campaign also has <code>delivery</code>: <code>{"{ sent, failed, pending }"}</code> counts of its messages.</p></Endpoint>
      <Endpoint method="POST" path="/campaigns" scope="marketing:write">
        <p>Body: <code>name</code> (1 to 100), <code>channel</code> (<code>email</code> or <code>sms</code>), <code>body</code> (1 to 2000; texts at most 320), optional <code>subject</code> (up to 150; required for email), optional <code>audience</code>. Answers <code>201</code> with the draft.</p>
        <p><code>409</code> with the app&apos;s message when an email has no subject, a text is over 320 characters, or the business has no verified text number for a text campaign.</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/campaigns/{id}" scope="marketing:write"><p>Any of the create fields; the rest stay as they were. <code>audience</code>, when sent, replaces the whole audience. A sent campaign cannot be edited: <code>409</code>.</p></Endpoint>
      <Endpoint method="DELETE" path="/campaigns/{id}" scope="marketing:delete"><p>Deletes the campaign. Messages it already queued stay in the delivery log.</p></Endpoint>
      <Endpoint method="GET" path="/campaigns/{id}/audience" scope="marketing:read"><p>How many clients the campaign would reach right now: <code>count</code> and up to eight example names (<code>sample</code>).</p></Endpoint>
      <Endpoint method="POST" path="/campaigns/audience-preview" scope="marketing:read"><p>The same count for an audience you have not saved. Body: <code>channel</code>, optional <code>audience</code>. Sends nothing.</p></Endpoint>
      <Endpoint method="POST" path="/campaigns/{id}/send" scope="campaigns:send">
        <p>Queues one message per matching client (texts carry the STOP notice, emails an unsubscribe link) and marks the campaign sent. No body. Returns <code>queued</code> (the number of messages) and the campaign. Delivery then follows the normal pipeline: see <code>/notifications</code>.</p>
        <p>This cannot be undone and cannot be repeated: a second call, or one made while the first is still running, answers <code>409</code>, as does an audience nobody matches.</p>
      </Endpoint>

      <h2>Promo codes</h2>
      <Endpoint method="GET" path="/promo-codes" scope="marketing:read"><p>Active codes first. Optional <code>active</code> (<code>true</code> or <code>false</code>). Fields: <code>code</code>, <code>type</code> (<code>percent</code> or <code>amount</code>), <code>value</code> (a percent, or cents), <code>starts_at</code>, <code>expires_at</code>, <code>max_uses</code>, <code>uses_count</code>, <code>service_ids</code> (empty means any service), <code>min_subtotal_cents</code>, <code>active</code>.</p></Endpoint>
      <Endpoint method="GET" path="/promo-codes/{id}" scope="marketing:read"><p>One code.</p></Endpoint>
      <Endpoint method="POST" path="/promo-codes" scope="marketing:write">
        <p>Body: <code>code</code> (2 to 30 characters; it is upper-cased and anything but letters, digits and dashes is dropped), <code>type</code>, <code>value</code> (a percent from 1 to 100, or an amount in cents of at least 1), optional <code>starts_on</code> and <code>expires_on</code> (calendar days like <code>2026-12-31</code> in your business&apos;s time zone; the code is valid from the start of the first day to the end of the last), <code>max_uses</code>, <code>min_subtotal_cents</code>, <code>service_ids</code> (your services; <code>404</code> otherwise).</p>
        <p>A code that already exists answers <code>409</code>. Answers <code>201</code>.</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/promo-codes/{id}" scope="marketing:write"><p>Body: <code>active</code> (true or false). Turning a code off is the only change the app allows; create a new code for anything else.</p></Endpoint>

      <h2>Automations</h2>
      <p>Automations (workflows) send messages when something happens: a visit is booked, completed or cancelled, a client is created, a form or review comes in, a birthday, or a client has not visited for a while. Your business also has the built-in ones; they can be edited and switched off but not deleted.</p>
      <p>
        <code>trigger</code> is one of <code>appointment_booked</code>, <code>appointment_completed</code>, <code>appointment_cancelled</code>, <code>appointment_no_show</code>, <code>client_created</code>, <code>form_submitted</code>, <code>review_submitted</code>,
        <code> membership_payment_failed</code>, <code>birthday</code>, <code>no_visit</code>.
      </p>
      <p>
        <code>filters</code> (all optional): <code>service_ids</code>, <code>category_ids</code>, <code>location_ids</code>, <code>staff_ids</code> (your own ids; <code>404</code> otherwise), <code>tags</code>, <code>min_rating</code> and <code>max_rating</code> (1 to 5), <code>first_visit_only</code>, <code>online_only</code>, <code>days</code>
        (required for <code>no_visit</code>: days since the last visit).
      </p>
      <p>
        <code>steps</code> (1 to 20, run in order), each with a <code>type</code>: <code>wait</code> (<code>mode</code>: <code>delay</code>, <code>before_appointment</code> or <code>after_appointment</code>; <code>hours</code> 0 to 8760), <code>sms</code> (<code>body</code>), <code>email</code> (<code>subject</code>, <code>body</code>, optional <code>cta_label</code>), <code>review_request</code>,
        <code> reminder</code>, <code>tag</code> (<code>tag</code>), <code>notify_staff</code> (<code>to</code>: <code>owner</code> or <code>provider</code>; <code>body</code>). Each step may carry an <code>id</code> (made for you when missing). Messages can use placeholders such as <code>{"{first_name}"}</code>, <code>{"{business}"}</code> and <code>{"{booking_url}"}</code>.
        Steps that give loyalty points are not available through the API. The app&apos;s rules apply and answer <code>422</code> with its wording: for example a rating request needs the visit-completed trigger, and waiting <em>before</em> an appointment needs the appointment-booked trigger.
      </p>
      <Endpoint method="GET" path="/automations" scope="marketing:read"><p>Every automation, built-in ones included, with <code>sent_last_30_days</code> and <code>active_runs</code>.</p></Endpoint>
      <Endpoint method="GET" path="/automations/{id}" scope="marketing:read"><p>One automation.</p></Endpoint>
      <Endpoint method="GET" path="/automations/{id}/runs" scope="marketing:read"><p>Who went through it, newest first, each with its status (<code>active</code>, <code>done</code>, <code>cancelled</code>) and step log.</p></Endpoint>
      <Endpoint method="POST" path="/automations" scope="marketing:write"><p>Body: <code>name</code> (1 to 80), <code>trigger</code>, <code>steps</code>, optional <code>description</code> (up to 300), <code>filters</code>, <code>exit_on_booking</code> (stop as soon as the client books again; default false), <code>enabled</code> (default <strong>false</strong>: nothing sends until you turn it on). Answers <code>201</code>.</p></Endpoint>
      <Endpoint method="PATCH" path="/automations/{id}" scope="marketing:write"><p>Any of the create fields plus <code>enabled</code>; the rest stay as they were. <code>filters</code> and <code>steps</code>, when sent, replace the whole value. Sending only <code>enabled</code> is the on/off switch; turning off also cancels runs in flight.</p></Endpoint>
      <Endpoint method="POST" path="/automations/{id}/duplicate" scope="marketing:write"><p>A copy named &quot;... (copy)&quot;, switched off. Answers <code>201</code>.</p></Endpoint>
      <Endpoint method="DELETE" path="/automations/{id}" scope="marketing:delete"><p>Deletes a custom automation. A built-in one answers <code>409</code>: switch it off instead.</p></Endpoint>
    </>
  );
}
