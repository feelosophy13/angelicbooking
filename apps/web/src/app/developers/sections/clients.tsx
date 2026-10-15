import { Endpoint } from "../doc-kit";

/** Client notes, referral codes, visit history and submitted forms (the parts beyond list, create and update). Mounted by the developers page. */
export function ClientsDocs() {
  return (
    <>
      <h2>Client notes, history and referral codes</h2>
      <p>These extend the client endpoints above. Store credit and loyalty points are money-like and can only be changed in the staff app, and memberships are managed there too because they involve the card processor.</p>
      <Endpoint method="PATCH" path="/clients/{id}/notes/{note_id}" scope="clients:write">
        <p>Pin or unpin a note. Body: <code>pinned</code> (true or false, required). No other field can be sent. <code>404</code> when the note does not belong to that client.</p>
      </Endpoint>
      <Endpoint method="DELETE" path="/clients/{id}/notes/{note_id}" scope="clients:write">
        <p>Deletes the note for good, as the staff app does. Returns <code>{`{"data": {"id": "…", "deleted": true}}`}</code>.</p>
      </Endpoint>
      <Endpoint method="GET" path="/clients/{id}/appointments" scope="clients:read">
        <p>This client&apos;s visits (not blocked time), earliest first, in the same shape as <code>GET /appointments</code>. Query: <code>from</code>, <code>to</code> (ISO times, matched on the start), <code>status</code>, <code>limit</code>, <code>page</code>. Includes <code>total</code>. <code>422</code> for an unknown status.</p>
      </Endpoint>
      <Endpoint method="GET" path="/clients/{id}/submissions" scope="clients:read">
        <p>The forms this client has filled in, newest first: <code>id</code>, <code>form_id</code>, <code>form_name</code>, <code>form_kind</code>, <code>appointment_id</code>, <code>signed</code>, <code>signed_at</code>, <code>voided</code>, <code>voided_at</code>, <code>created_at</code>. This is a summary only. The answers (which can include health details) are read with <code>GET /form-submissions/{"{id}"}</code>, which needs <code>forms:read</code>.</p>
      </Endpoint>
      <Endpoint method="GET" path="/clients/{id}/referral-code" scope="clients:read">
        <p>Returns <code>{`{"data": {"client_id": "…", "referral_code": "MAYA-7K2P"}}`}</code>, or <code>referral_code: null</code> when the client has none yet.</p>
      </Endpoint>
      <Endpoint method="POST" path="/clients/{id}/referral-code" scope="clients:write">
        <p>Makes the client&apos;s referral code. <code>201</code> when a new one was made; <code>200</code> with the existing code if they already had one. Nothing is sent to the client.</p>
      </Endpoint>
    </>
  );
}
