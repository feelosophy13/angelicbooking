import { Code, Endpoint } from "../doc-kit";

/** Forms (the builder) and what clients submitted. Mounted by the developers page. */
export function FormsDocs() {
  return (
    <>
      <h2>Forms</h2>
      <p>Intake and consent forms, as built under Settings → Forms. Filling a form in for a client (which stores signatures and uploaded files) and emailing a signed copy are done in the staff app, not through the API.</p>
      <p>
        A form has: <code>name</code> (1 to 120), <code>kind</code> (<code>intake</code> or <code>consent</code>), <code>description</code> (up to 4000, or <code>null</code>; the text to sign), <code>fields</code> (the questions, below), <code>require_signature</code>, <code>apply_to_all</code> (required before every visit), <code>service_ids</code> (or only visits with these services), <code>renew_days</code> (a whole number of days before it must be signed again; <code>null</code> = once ever), <code>location_ids</code> (only visits at these sites; empty, or naming every site, means everywhere) and <code>active</code>. A form needs at least one question or some description text. Every service and location id must be yours (<code>404</code> otherwise).
      </p>
      <p>
        Each question in <code>fields</code> (up to 100): <code>type</code> (one of <code>text</code>, <code>textarea</code>, <code>yesno</code>, <code>select</code>, <code>multiselect</code>, <code>number</code>, <code>date</code>, <code>phone</code>, <code>email</code>, <code>file</code>, <code>checkbox</code> (an agreement box that must be ticked), <code>initials</code>, <code>statement</code>, <code>heading</code>), <code>label</code> (1 to 1000), optional <code>id</code> (letters, digits, <code>-</code> and <code>_</code>, up to 40, unique in the form; made for you when omitted; keep it stable when editing so old answers still line up), <code>required</code> (ignored for <code>statement</code> and <code>heading</code>, which take no answer), <code>options</code> (1 to 30 choices, only for <code>select</code> and <code>multiselect</code>), <code>show_if</code> (<code>{`{"field_id": "…", "equals": "Yes"}`}</code>: show only when an <em>earlier</em> checkbox, yes/no, select or multiselect question has that answer) and <code>map_to</code> (copy the answer onto the client: <code>email</code> or <code>notes</code> for email; <code>phone</code> or <code>notes</code> for phone; <code>birthday</code> or <code>notes</code> for date; <code>tag</code> or <code>notes</code> for yes/no and checkbox; <code>notes</code> for text, paragraph, select, multiselect and number), with <code>tag</code> (up to 40) as the tag name when <code>map_to</code> is <code>tag</code>. Anything the form builder would refuse is a <code>422</code> that names the question.
      </p>
      <Endpoint method="GET" path="/forms" scope="forms:read"><p>Live forms first, then by name, each with a <code>field_count</code> instead of the questions. <code>limit</code>, <code>page</code>.</p></Endpoint>
      <Endpoint method="GET" path="/forms/{id}" scope="forms:read"><p>One form with its questions.</p></Endpoint>
      <Endpoint method="POST" path="/forms" scope="forms:write">
        <p>Body: <code>name</code> and <code>kind</code> are required; everything else is optional. Defaults: <code>require_signature: true</code>, <code>apply_to_all: false</code>, <code>active: true</code>, no questions, no services, every location. Returns <code>201</code> with the form.</p>
      </Endpoint>
      <Code>{`{ "name": "Colour consent", "kind": "consent", "description": "I understand the risks of colour services.",
  "apply_to_all": false, "service_ids": ["…"], "renew_days": 365,
  "fields": [
    { "id": "allergy", "type": "yesno", "label": "Any allergies?", "required": true, "map_to": "tag", "tag": "allergy" },
    { "id": "which", "type": "text", "label": "Which ones?", "show_if": { "field_id": "allergy", "equals": "Yes" } }
  ] }`}</Code>
      <Endpoint method="PATCH" path="/forms/{id}" scope="forms:write">
        <p>Send only what changes; unknown fields are rejected. Sending <code>fields</code> replaces the whole list of questions. Removing every question and the description is a <code>422</code>.</p>
      </Endpoint>
      <Endpoint method="DELETE" path="/forms/{id}" scope="forms:write">
        <p>Like the staff app: a form that clients have already submitted is archived (<code>active: false</code>) so the signed copies stay; a form nobody has submitted is deleted. The response says which: <code>{`{"id": "…", "deleted": true, "archived": false}`}</code>.</p>
      </Endpoint>
      <Endpoint method="POST" path="/forms/{id}/duplicate" scope="forms:write"><p>A copy named &ldquo;Copy of …&rdquo;, inactive until you turn it on. Returns <code>201</code> with the new form.</p></Endpoint>

      <h2>Form submissions</h2>
      <Endpoint method="GET" path="/form-submissions" scope="forms:read">
        <p>Newest first: <code>id</code>, <code>form_id</code>, <code>form_name</code>, <code>form_kind</code>, <code>client_id</code>, <code>client_name</code>, <code>appointment_id</code>, <code>signed</code>, <code>signature_name</code>, <code>signed_at</code>, <code>assisted_by_staff</code> (completed at the front desk), <code>voided</code>, <code>created_at</code>. No answers in the list. Query: <code>form_id</code>, <code>client_id</code> (<code>404</code> if not yours), <code>q</code> (client name), <code>include_voided</code> (default <code>true</code>; send <code>false</code> to hide void ones), <code>limit</code>, <code>page</code>. Includes <code>total</code>.</p>
      </Endpoint>
      <Endpoint method="GET" path="/form-submissions/{id}" scope="forms:read">
        <p>The summary plus <code>void_reason</code>, <code>voided_at</code> and <code>answers</code>: one entry per question (as the form was when signed) with <code>field_id</code>, <code>label</code>, <code>type</code> and <code>value</code> (a string, <code>true</code>/<code>false</code> for a checkbox, a list for multiselect). Uploaded files are not returned (<code>value: null</code>, <code>has_file: true</code>), and neither are the drawn signature image or the signer&apos;s IP address.</p>
      </Endpoint>
      <Endpoint method="POST" path="/form-submissions/{id}/void" scope="forms:write">
        <p>Body: optional <code>reason</code> (up to 200). The submission stays on file, struck through, and no longer counts as signed. <code>409</code> when it is already void.</p>
      </Endpoint>
      <Endpoint method="POST" path="/form-submissions/{id}/reassign" scope="forms:write">
        <p>Body: <code>client_id</code>. Moves a submission filed under the wrong person to the right client, and detaches it from any visit. <code>404</code> when the client is not yours.</p>
      </Endpoint>
    </>
  );
}
