# Terminology: who is who

The words we use for people, in the product, the code and the database. Use the **product word** in anything a
person reads (screens, emails, texts, help). The **code word** is what to search for. Two different things must
never share a word: a *login* is not a *staff member*, and a *client* is not a *user*.

## The people

| Product word | Who they are | Code / database | Signs in? |
|---|---|---|---|
| **Platform admin** | Us, the company running Angelic Booking. Sees every business, can suspend, comp or extend a trial. | `apps/admin`, DB role `angelic_admin` (reads across all tenants, mostly read-only) | Yes, admin app with TOTP |
| **Business** | One salon or spa that subscribes. Everything it owns (clients, services, sales) is private to it. Also called a *tenant* in technical docs only. | `businesses` row = Better Auth `organization` (same id); `business_id` on every table | n/a |
| **Owner** | The person who created the business. Full access including billing and Stripe. Cannot be edited or removed. | `member.role = 'owner'` | Yes |
| **Manager** | Runs the business day to day: everything except business settings and Stripe. | role `manager` | Yes |
| **Front desk** | Books, checks in and checks out for everyone. No reports or setup. | role `front_desk` | Yes |
| **Provider** | Does the services. Sees their own calendar and checkout. | role `provider` | Yes |
| **Custom role** | A role the owner makes under Roles & permissions, with any mix of permissions. | `roles` table (`key` stored in `member.role`) | Yes |
| **Staff member** | A person on the schedule who can be booked, with hours, services, pay and commission. | `staff` row | Not necessarily |
| **Login** (the API and some error messages say "team member") | A sign-in that belongs to a business with a role. | Better Auth `user` + `member` | Yes |
| **Client** | A customer of the business: history, notes, packages, points. Created by staff, by an online booking or by import. | `clients` row | Not necessarily |
| **Client account** | A client who has signed in on the booking page to see and manage their own visits. Optional per business. | `clientAccountsEnabled`; a separate client session on the booking page (not a Better Auth login) tied to a `clients` row | Booking page only |
| **Guest** | Someone booking online without an account. Becomes a client when the booking is made. | no row of its own | No |

### Staff member vs login

They are separate on purpose:

- A **staff member** can exist with no login (for example a stylist who is booked but never opens the app). `staff.user_id` is empty until they accept an invite.
- A **login** can exist with no staff member (for example an accountant with a Manager role who is never booked).
- Most owners and providers are both, and the two are linked by `staff.user_id`.

Say "add staff" for the person on the schedule and "invite" or "give access" for the login.

### Staff pay terms

Pay type is a property of the staff member, not of the role: **Commission** (a share of sales; the salon's
"1099" providers), **Hourly** and **Salary**. Product sales have their own commission rate. Do not call a
commission provider "contractor" or "employee" in the product; that is the owner's tax status, not ours.

## Words that are easy to mix up

| Say | Not | Why |
|---|---|---|
| Client | Customer, user, guest | "User" is a login. "Customer" is only for someone paying the platform (the business). |
| Business | Salon, account, tenant, organization | The product serves spas and others too. "Tenant" and "organization" are code words. |
| Subscriber | | The business, when talking about billing the platform. |
| Provider | Stylist, technician, employee | The role name. A business may still say "stylist" in its own copy. |
| Staff member | Team member, employee | "Team member" appears only in the public API and a few error messages, where it means a staff member. |
| Login | User, account | "Account" is reserved for a client account. |
| Role | Permission, level | A role is a named bundle of permissions. Permissions are the single abilities inside it. |
| Platform admin | Admin, superadmin | A business's own Owner and Manager are not "admins". |

## Where things happen

- **Staff dashboard** (`/app/<slug>`): Owner, Manager, Front desk, Provider and custom roles. What each sees is set by role permissions.
- **Mobile app** (`apps/mobile`): staff logins only. The day's agenda and appointment status.
- **Booking page** (`/book/<slug>`, `/embed/<slug>`): clients and guests. No staff features.
- **Clock-in kiosk**: staff members at the shop, using a PIN or QR code; no login needed.
- **Admin app** (`apps/admin`): platform admins only. Never reachable from a business.

## Permissions at a glance

| | Owner | Manager | Front desk | Provider |
|---|---|---|---|---|
| Business settings, Stripe, billing | ✓ | | | |
| Logins and roles | ✓ | ✓ | | |
| Staff, services and products | ✓ | ✓ | | |
| Reports and payroll | ✓ | ✓ | | |
| Every calendar | ✓ | ✓ | ✓ | |
| Own calendar | ✓ | ✓ | ✓ | ✓ |
| Clients (view) | ✓ | ✓ | ✓ | ✓ |
| Clients (add and edit) | ✓ | ✓ | ✓ | |
| Checkout | ✓ | ✓ | ✓ | ✓ |
| Log supplies used | ✓ | ✓ | ✓ | ✓ |

These are the defaults. An owner can edit the Manager, Front desk and Provider roles, and the Owner role is fixed.
The exact list of permissions is in `packages/core/src/permissions.ts`, which is the source of truth: if this
table and that file disagree, the file is right and this page is out of date.
