import { Endpoint } from "../doc-kit";

/** Team: staff profiles, hours, time off, services, pay, the time clock and roles. Mounted by the developers page. */
export function TeamDocs() {
  return (
    <>
      <h2>Team</h2>
      <p>Staff profiles, weekly hours, days off, the services each person performs, pay settings, time clock entries and roles. Logins, invitations, who holds which role, clock-in PINs and calendar-feed links are not in the API: those stay in the staff app. Contact details need <code>staff:read</code>; pay needs its own scopes (<code>pay:read</code>, <code>pay:write</code>), so a key that manages hours cannot see what anyone earns.</p>
      <p>Every PATCH and PUT takes only the fields you send and leaves the rest as they are. Unknown fields are rejected with <code>422</code>. An id from another business answers <code>404</code>.</p>

      <h2>Team members</h2>
      <Endpoint method="GET" path="/team" scope="staff:read">
        <p>Every team member, inactive ones included, with contact details. Query: <code>active</code> (<code>true</code> or <code>false</code>), <code>limit</code>, <code>page</code>. Each member: <code>id</code>, <code>display_name</code> (what clients see), <code>full_name</code> (private), <code>email</code>, <code>phone</code>, <code>position</code>, <code>bio</code>, <code>photo_url</code>, <code>color</code> (<code>#rrggbb</code>), <code>location_id</code> (primary location), <code>bookable_online</code>, <code>takes_appointments</code>, <code>active</code>, <code>sort_order</code>, <code>rotation_weeks</code>, <code>created_at</code>. Pay, PINs, calendar tokens and logins are never included.</p>
      </Endpoint>
      <Endpoint method="GET" path="/team/{id}" scope="staff:read" />
      <Endpoint method="POST" path="/staff" scope="staff:write">
        <p>Add a team member. Required: <code>display_name</code> (1 to 80 characters). Optional: <code>full_name</code>, <code>email</code>, <code>phone</code> (up to 30), <code>color</code> (<code>#rrggbb</code>), <code>bio</code> (up to 300), <code>position</code> (up to 60), <code>location_id</code>, <code>takes_appointments</code> (default <code>true</code>), <code>bookable_online</code> (default <code>true</code>), <code>active</code> (default <code>true</code>), <code>sort_order</code>.</p>
        <p>Like the app, a new person starts with hours Tuesday to Saturday, 9:00 to 17:00; replace them with <code>PUT /staff/{"{id}"}/schedule</code>. Returns <code>201</code>.</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/staff/{id}" scope="staff:write">
        <p>Same fields as above, all optional. Send <code>{`{"active": false}`}</code> to deactivate someone (people are never deleted, their history points at them). Someone who does not take appointments is never bookable online, so <code>bookable_online</code> is switched off whenever <code>takes_appointments</code> is false. Blank text clears a field. <code>404</code> when <code>location_id</code> is not one of your locations.</p>
      </Endpoint>

      <h2>Hours, time off and services</h2>
      <p>Read a person&apos;s schedule with <code>GET /staff/{"{id}"}/schedule</code> (needs <code>staff:read</code>); it returns the weekly hours, upcoming time off and the services they perform.</p>
      <Endpoint method="PUT" path="/staff/{id}/schedule" scope="staff:write">
        <p>Replaces the weekly hours. Body: <code>weekly</code> (required): a list of blocks <code>{`{"weekday": 1, "start": "09:00", "end": "17:00"}`}</code>, <code>weekday</code> 0 (Sunday) to 6, 24-hour local time, optional <code>week_index</code> (0 to 3, default 0) and <code>location_id</code>. A day with a lunch break or split shift is several blocks. A day with no block is a day off. An empty list clears all hours.</p>
        <p>Optional: <code>rotation_weeks</code> (1 to 4: hours repeat every N weeks) and <code>this_week_is</code> (0-based: which week of the cycle the current week is; default 0). Leave both out to keep the current rotation. Rules, as in the app: <code>start</code> before <code>end</code>, blocks on one day may not overlap, at most 12 blocks per day, <code>week_index</code> below <code>rotation_weeks</code> (<code>422</code> otherwise). In a single-location business the location is stored as &quot;the only one&quot;. Returns the new schedule.</p>
      </Endpoint>
      <Endpoint method="GET" path="/staff/{id}/overrides" scope="staff:read">
        <p>Days off and changed hours with their ids, from today on (or <code>?from=YYYY-MM-DD</code>, optional <code>?to=</code>). Each: <code>id</code>, <code>date</code>, <code>is_off</code>, <code>start</code>, <code>end</code>, <code>note</code>.</p>
      </Endpoint>
      <Endpoint method="POST" path="/staff/{id}/overrides" scope="staff:write">
        <p>A day off or changed hours. Body: <code>date</code> (required), <code>kind</code> (<code>off</code> or <code>hours</code>, required), optional <code>to</code> (last day of a range, up to a year; every day gets the same entry), <code>start</code> and <code>end</code> (required for <code>hours</code>, not allowed for <code>off</code>), <code>note</code> (up to 200). A date that already has an entry is replaced. Returns <code>201</code> with the entries.</p>
      </Endpoint>
      <Endpoint method="DELETE" path="/staff/{id}/overrides/{override_id}" scope="staff:write"><p>Removes one entry. <code>404</code> when it is not that person&apos;s.</p></Endpoint>
      <Endpoint method="GET" path="/staff/{id}/services" scope="staff:read"><p>The services they perform: <code>service_id</code>, <code>price_cents</code> and <code>duration_min</code> (their own; <code>null</code> means the service&apos;s price or length).</p></Endpoint>
      <Endpoint method="PUT" path="/staff/{id}/services" scope="staff:write">
        <p>Replaces which services they perform. Body: <code>services</code>, a list of <code>{`{"service_id": "…", "price_cents": 6500, "duration_min": 45}`}</code>. <code>price_cents</code> (0 or more) and <code>duration_min</code> (5 to 600) are optional: leave one out to keep what is stored, send <code>null</code> to use the service&apos;s own, and a value equal to the service&apos;s own is stored as &quot;use the service&apos;s&quot;. A service may appear once. <code>404</code> if a <code>service_id</code> is not yours. Returns the resulting list.</p>
      </Endpoint>

      <h2>Pay</h2>
      <p>Pay settings are kept as a history: each change takes effect on a date, and payroll for a past period uses the settings in force then. Percentages are in basis points (<code>4000</code> = 40%). Payroll runs themselves are not in the API.</p>
      <Endpoint method="GET" path="/staff/{id}/pay" scope="pay:read">
        <p>Returns <code>position</code>, <code>current</code> (the settings in force today) and <code>history</code> (each change, oldest first, with <code>effective_from</code> and <code>note</code>). Settings: <code>pay_type</code> (<code>commission</code>, <code>hourly</code>, <code>salary</code>), <code>main_commission_bps</code>, <code>product_commission_bps</code>, <code>cc_tip_fee_bps</code>, <code>hourly_rate_cents</code>, <code>salary_per_period_cents</code>, <code>overtime_override</code> (<code>true</code>, <code>false</code> or <code>null</code> = follow the payroll run), <code>tax_deduction_cents</code>, <code>tax_deduction_bps</code> (both normally <code>null</code>).</p>
      </Endpoint>
      <Endpoint method="PUT" path="/staff/{id}/pay" scope="pay:write">
        <p>Records a pay change. Any of the settings above, plus <code>position</code> (up to 60; it changes at once, it is not pay), <code>effective_from</code> (default today; a future date leaves the current settings in force until then) and <code>note</code> (up to 200). A setting you leave out keeps the value in force on <code>effective_from</code>. A second change on the same date replaces the first. <code>422</code> when <code>pay_type</code> is <code>hourly</code> without an hourly rate or <code>salary</code> without a salary. Each change is written to the activity log. Returns the same as GET.</p>
      </Endpoint>

      <h2>Time clock</h2>
      <p>Hours worked, whether clocked in at the kiosk or added by hand. Clocking in and out, and the clock-in PINs and QR codes, are not in the API.</p>
      <Endpoint method="GET" path="/time-entries" scope="time:read">
        <p>Newest first. Query: <code>staff_id</code>, <code>from</code> and <code>to</code> (<code>YYYY-MM-DD</code>, on the entry&apos;s date), <code>limit</code>, <code>page</code>. Includes <code>total</code>. Each: <code>id</code>, <code>staff_id</code>, <code>date</code>, <code>minutes</code>, <code>hours</code>, <code>clock_in_at</code>, <code>clock_out_at</code>, <code>location_id</code>, <code>note</code>, <code>created_at</code>. An entry still clocked in has <code>minutes</code> 0 and no <code>clock_out_at</code>.</p>
      </Endpoint>
      <Endpoint method="POST" path="/time-entries" scope="time:write">
        <p>Add hours by hand. Body: <code>staff_id</code>, <code>date</code> and <code>hours</code> (0.25 to 24) are required; <code>note</code> (up to 120) is optional. Returns <code>201</code>.</p>
      </Endpoint>
      <Endpoint method="DELETE" path="/time-entries/{id}" scope="time:delete"><p>Removes the entry for good, as the app does.</p></Endpoint>

      <h2>Roles and permissions</h2>
      <p>The roles a business can give to people who log in. Giving a role to a person is done in the staff app, not here. A role made or changed through the API is saved on your account at once; it is registered with the sign-in system the next time someone saves it in the app, so assign it to people from the app.</p>
      <Endpoint method="GET" path="/roles" scope="roles:read">
        <p>All roles: <code>id</code>, <code>key</code>, <code>name</code>, <code>description</code>, <code>permissions</code>, <code>is_system</code> (built-in), <code>is_locked</code> (the Owner role), <code>member_count</code> (how many people hold it), <code>sort_order</code>.</p>
      </Endpoint>
      <Endpoint method="GET" path="/roles/{id}" scope="roles:read" />
      <Endpoint method="GET" path="/roles/permissions" scope="roles:read"><p>Every permission a role can hold, grouped like the role editor: <code>groups</code> (each with <code>title</code> and <code>permissions</code> with <code>action</code>, <code>label</code>, <code>description</code>) and the flat list <code>actions</code>.</p></Endpoint>
      <Endpoint method="POST" path="/roles" scope="roles:write">
        <p>Body: <code>name</code> (2 to 40 characters) and <code>permissions</code> (at least one action from <code>/roles/permissions</code>, each once) are required; <code>description</code> (up to 160) is optional. The <code>key</code> is made from the name. Returns <code>201</code>.</p>
      </Endpoint>
      <Endpoint method="PATCH" path="/roles/{id}" scope="roles:write">
        <p>Any of <code>name</code>, <code>description</code>, <code>permissions</code>. The Owner role cannot be changed (<code>409</code>). Built-in roles can be edited.</p>
      </Endpoint>
      <Endpoint method="DELETE" path="/roles/{id}" scope="roles:delete">
        <p>Deletes a custom role. <code>409</code> for a built-in role, and when people still hold it (move them to another role in the app first).</p>
      </Endpoint>
    </>
  );
}
