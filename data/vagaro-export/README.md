# Vagaro full export: Angelic Beauty

Pulled 2026-10-10 from the signed-in Vagaro merchant session. Flat CSVs are in this folder; untouched API responses are in `raw/` (passwords, security questions, and API secrets stripped).

## Business

- **Angelic Beauty**, 14 Pidgeon Hill Drive, Sterling Virginia 20165, phone 5715777271, email hello@angelicbeautyva.com
- Vagaro URL: angelicbeautyva  Website: https://www.angelicbeautyva.com/
- Business hours: Mon 10:00:00-17:00:00; Tue 10:00:00-18:00:00; Thu 10:00:00-18:00:00; Fri 10:00:00-18:00:00; Sat 10:00:00-19:00:00; Sun 10:00:00-17:00:00
- Tax: Tax 1 6.0%; payment methods: Tiffany, Venmo, Gift Certificate, Cash, Membership, N, Invoice, Employee Credit, Zelle
- Online booking: lead time 1 (type 2), increment 75 min, cancel window 48 h, customer may cancel online: True, confirmation required: False
- No-show/late-cancel fee: $0.0 or 0.0%
- Reminders: 48 h before; confirmation request 72 h before
- Access levels: Admin (1), Front desk (5), House (1), Lash Artist/Esthetician (5), Manager / Supervisor (1), Owner (0), PMU Booth Rental (0)
- Full detail: `business.json`

## Employees (14)

| Name | Role | Email | Cell | Services | Working hours |
|---|---|---|---|---|---|
| Tiffany Yi | Account Owner | angeliclashesbytiffany@gmail.com | 5713706090 | 115 | Mon 10:00-17:00; Tue 10:00-17:00; Thu 10:00-17:00; Fri 10:00-17:00; Sat 10:00-17:00; Sun 10:00-17:00 |
| Brittany P | Manager / Supervisor | brittany@angeliclashesbytiffany.com | 5714990977 | 0 |  |
| Samantha D | Lash Artist/Esthetician | samanthamaed3@gmail.com | 7035376362 | 80 | Mon 10:00-17:00; Tue 10:00-18:00; Thu 10:00-18:00; Sat 10:00-19:00 |
| Ashley A | Lash Artist/Esthetician | ashayurzana@yahoo.com | 2133730099 | 117 | Mon 10:00-17:00; Thu 10:00-18:00; Fri 10:00-18:00; Sat 10:00-19:00; Sun 10:00-17:00 |
| Raina C | Lash Artist/Esthetician | moonjjang22@gmail.com | 2019738181 | 117 | Mon 10:00-17:00; Tue 10:00-18:00; Thu 10:00-18:00; Fri 10:00-18:00; Sat 10:00-19:00; Sun 10:00-17:00 |
| Phoebe S | Front desk | phoebe.svay@gmail.com | 5713383159 | 0 |  |
| Dasia J | Lash Artist/Esthetician | info@angelicbeautyva.com | 5717742227 | 83 | Thu 10:00-18:00; Fri 10:00-18:00; Sun 10:00-17:00 |
| Admin User | Admin | admin@angelicbeautyva.com |  | 0 |  |
| Bich Vo | Front desk | bnphamvo@gmail.com |  | 0 |  |
| Amy B | Lash Artist/Esthetician | amystephb@gmail.com | 7037636527 | 76 | Sat 10:00-19:00; Sun 10:00-17:00 |
| Cara Muller | Front desk | caramuller11@gmail.com | 7036083039 | 0 |  |
| Jeanne Paulin | Front desk | jeanne.paulin323@gmail.com | 5712010103 | 0 |  |
| House Online | House | info@angeliclashesbytiffany.com |  | 0 |  |
| Jenny Ko | Front desk | jennyyk929@gmail.com | 7038671608 | 0 |  |

Maria C appears in the Vagaro employee list but not in the calendar/employee API (likely deactivated), so she is not in `employees.csv`.

Per-employee service prices and durations are in `employee_services.csv`; per-day hours in `employee_hours.csv`.

## Memberships (10 plans) and packages (10)

| Membership | Price | Frequency | Active sold |
|---|---|---|---|
| Keratin Lash Lift + Tint Membership | $89.99 | Monthly | 7 |
| Classic 2 week Membership | $109.99 | Monthly | 0 |
| Hybrid 2 week Membership | $128.99 | Monthly | 9 |
| Volume 2 week Membership | $139.99 | Monthly | 3 |
| Mega Volume 2 week Membership | $178.99 | Monthly | 0 |
| Angelic LED™ Classic 3 week Membership | $209.00 | Every 6 Weeks | 1 |
| Angelic LED™ Classic (4 week membership) | $149.00 | Monthly | 0 |
| Angelic LED™ Hybrid 3 week Membership | $239.00 | Every 6 Weeks | 2 |
| Angelic LED™ Hybrid (4 week membership) | $169.00 | Monthly | 1 |
| Angelic LED™ Volume 3 week Membership | $279.00 | Every 6 Weeks | 1 |

| Package | Price | Sessions | Sold |
|---|---|---|---|
| Intensive Rejuvenation (4 BioPeel + 1 Oxygen) | $1030.00 | 5 | 0 |
| Ultimate Skin Renewal (4 BioPeel + 2 Booster + 2 Oxygen) | $1500.00 | 8 | 2 |
| Glow & Oxygen Booster (3 Booster + 2 Oxygen) | $1000.00 | 5 | 0 |
| Premium Lifting & Firming (3 V-Lift + 1 Oxygen + 1 Glow) | $825.00 | 5 | 0 |
| Radiant Glow & Booster (1 Booster + 2 Oxygen + 2 Glow) | $800.00 | 5 | 0 |
| Signature Glow & Lift (1 V-Lift + 1 Oxygen + 1 Glow) | $450.00 | 3 | 0 |
| SPECIAL Oxygen Therapy (Buy 3 + 1 Free) -- Save $180! | $540.00 | 4 | 1 |
| SPECIAL Bio Peel (Buy 3 + 1 Free) -- Save $250! | $750.00 | 4 | 4 |
| SPECIAL Hair/Scalp Care (Buy 3 + 1 Free) -- Save $200! | $600.00 | 4 | 0 |
| Angelic Facial Starter (3-Pack) | $560.00 | 6 | 1 |

Sold memberships (all statuses): 853, of which active (not inactive/deleted/paused): 147. See `sold_memberships.csv`.
Sold packages on file: 56 (`sold_packages.csv`). Gift cards: 120 (`gift_cards.csv`).

## Catalog

- Services: 125 in 13 categories (`services_full.csv`, merchant-side detail incl. cost, processing time, cleanup, tax, points)
- Add-ons: 45 in 8 groups (`addons.csv` from the first export; raw in `raw/`)
- Classes: 10 (`classes.csv`); resources: 1 (`resources.csv`); discounts: 10 (`discounts.csv`); products: 188 (`products.csv`)

## Customers (9873)

`customers.csv` has contact, address, birthday, customer-since, last visit, bookings, no-shows, lifetime spend, points, membership, tags, and referral source. Customer records span both Vagaro locations (Angelic Beauty and Angelic Lashes by Tiffany).

## Appointments

- Range pulled: 2025-10-01 to 2027-10-31. Booked appointments: 4492 (127 on or after 2026-10-10). Calendar blocks / PTO / personal tasks: 1776 (`calendar_blocks.csv`).
- Appointments by employee: Raina C 2030, Tiffany Yi 726, Samantha D 607, Dasia J 500, Ashley A 391, Amy B 238
- Status codes seen (Vagaro internal): 5: 4346, 1: 94, 11: 36, 3: 12, 10: 4
- Each row has customer name, phone, service, add-ons, time, employee, price label, and membership/package/deposit flags.
