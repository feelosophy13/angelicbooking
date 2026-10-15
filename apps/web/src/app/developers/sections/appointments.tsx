import { Code, Endpoint } from "../doc-kit";

/** Editing a visit's services, standing appointments, classes, blocked time and the waitlist (beyond book, move and cancel). Mounted by the developers page. */
export function AppointmentsDocs() {
  return (
    <>
      <h2>Changing the services on a visit</h2>
      <p>A visit can hold several services (each is an <em>item</em> in the <code>items</code> list of the appointment). Fees, deposits and refunds are money and stay in the staff app. To change a visit&apos;s notes or status use <code>PATCH /appointments/{"{id}"}</code>; <code>GET /appointments/{"{id}"}</code> is unchanged.</p>
      <Endpoint method="POST" path="/appointments/{id}/services" scope="appointments:write">
        <p>Add another service to an existing visit. Body: <code>service_id</code>, <code>staff_id</code>, <code>start_at</code> (ISO 8601 with an offset or <code>Z</code>), all required. Returns <code>201</code> with the appointment. <code>409</code> when the time is taken, the provider does not perform that service, the service is not offered at the visit&apos;s site, or the visit is cancelled, completed or a no-show. No message is sent to the client.</p>
      </Endpoint>
      <Endpoint method="POST" path="/appointments/{id}/items/{item_id}/move" scope="appointments:write">
        <p>Move one service of a visit (with its finishing part, if it has one), optionally to another provider. Body: <code>start_at</code> (required), <code>staff_id</code>, <code>notify</code> (default <code>true</code>: tells the client if they opted in). <code>409</code> when the time is taken or outside the provider&apos;s hours; a seat in a class cannot be moved. <code>404</code> when the item is not part of that visit.</p>
      </Endpoint>
      <Endpoint method="DELETE" path="/appointments/{id}/items/{item_id}" scope="appointments:write">
        <p>Take one service off the visit. Taking off the last one cancels the visit, and then the client is told unless you add <code>?notify=false</code>. <code>409</code> when the service was already removed or the visit is cancelled, completed or a no-show.</p>
      </Endpoint>

      <h2>Standing appointments</h2>
      <p>A standing appointment books the same service every N weeks. Each visit is an ordinary appointment (<code>GET /appointments</code> lists them).</p>
      <Endpoint method="POST" path="/series" scope="appointments:write">
        <p>Body: <code>service_id</code>, <code>staff_id</code>, <code>start_at</code> (the first visit), <code>interval_weeks</code> (one of 1, 2, 3, 4, 5, 6, 8, 12) and <code>occurrences</code> (2 to 52, counting the first) are required. Optional: <code>client_id</code> (omit for no client), <code>notes</code>, <code>location_id</code>, <code>notify</code> (default <code>true</code>: one confirmation for the first visit, reminders for the rest, for clients who opted in).</p>
        <p>Dates the provider cannot take (time off, outside hours, already booked) are skipped and listed in <code>skipped</code> as <code>{`{"start_at", "reason"}`}</code>. <code>409</code> when none of the dates work. Returns <code>201</code> with the series, its <code>occurrences</code> and <code>skipped</code>.</p>
      </Endpoint>
      <Code>{`{ "data": { "id": "…", "client_id": "…", "service_id": "…", "staff_id": "…", "interval_weeks": 2, "first_start_at": "…",
    "planned_occurrences": 6, "notes": null, "ended_at": null,
    "occurrences": [ { "appointment_id": "…", "status": "booked", "start_at": "…" } ],
    "skipped": [ { "start_at": "…", "reason": "not available" } ] } }`}</Code>
      <Endpoint method="GET" path="/series/{id}" scope="appointments:read"><p>The series and every visit booked from it, in date order, with each visit&apos;s status.</p></Endpoint>
      <Endpoint method="POST" path="/appointments/{id}/cancel-series" scope="appointments:write">
        <p>Cancel this visit and every later open (booked or confirmed) visit in its series, and end the series. Body: optional <code>reason</code> (up to 500), <code>notify</code> (default <code>true</code>: the client hears about the first cancelled visit; reminders for all of them stop). No fee is charged. <code>409</code> when the visit is not part of a series. Returns <code>cancelled_appointment_ids</code> and a count; calling it again returns a count of 0.</p>
      </Endpoint>

      <h2>Classes</h2>
      <p>A service with a group size above 1 is run as scheduled sessions. Each client who joins gets an ordinary appointment (one item pointing at the session), so it shows in <code>GET /appointments</code> too.</p>
      <Endpoint method="GET" path="/classes" scope="appointments:read">
        <p>Sessions with seats booked and left: <code>id</code>, <code>service_id</code>, <code>service_name</code>, <code>staff_id</code>, <code>staff_name</code>, <code>location_id</code>, <code>start_at</code>, <code>end_at</code>, <code>capacity</code>, <code>booked</code>, <code>seats_left</code>, <code>price_cents</code>, <code>notes</code>, <code>status</code> (<code>scheduled</code> or <code>cancelled</code>). Query: <code>from</code>, <code>to</code> (ISO times; default now to 60 days ahead; at most a year apart), <code>service_id</code>, <code>include_cancelled=true</code>, <code>limit</code>, <code>page</code>.</p>
      </Endpoint>
      <Endpoint method="GET" path="/classes/{id}" scope="appointments:read"><p>One session plus its <code>roster</code>: <code>appointment_id</code>, <code>status</code>, <code>client_id</code>, <code>first_name</code>, <code>last_name</code>, <code>source</code>, <code>booked_at</code>. No contact details.</p></Endpoint>
      <Endpoint method="POST" path="/classes" scope="appointments:write">
        <p>Schedule a session. Body: <code>service_id</code>, <code>staff_id</code>, <code>start_at</code> (required), optional <code>capacity</code> (1 to 500; default is the service&apos;s group size) and <code>notes</code> (up to 300). <code>409</code> when the service has a group size of 1, is inactive, or the instructor is not free then (use <code>/availability</code> for open times). The seat price is the service price. Returns <code>201</code>.</p>
      </Endpoint>
      <Endpoint method="POST" path="/classes/{id}/enrollments" scope="appointments:write">
        <p>Give a client a seat. Body: <code>client_id</code> (required; <code>null</code> for a walk-in), optional <code>notes</code> (up to 300), <code>notify</code> (default <code>true</code>: a confirmation, if the client opted in). <code>409</code> when the class is full, already started, cancelled, or the client already has a seat. No deposit or payment is taken. Returns <code>201</code> with the new <code>appointment_id</code> and the updated class.</p>
      </Endpoint>
      <Endpoint method="POST" path="/classes/{id}/cancel" scope="appointments:write">
        <p>Cancel the session and every open seat in it. Body: optional <code>reason</code> (up to 200), <code>notify</code> (default <code>true</code>: each client is told). Nothing is refunded. <code>409</code> when it is already cancelled. Returns the class and <code>cancelled_appointment_ids</code>. To cancel one client&apos;s seat, cancel their appointment.</p>
      </Endpoint>
    </>
  );
}
