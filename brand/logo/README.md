# Angelic Booking logo

Built 2026-10-19 from the Angelic Beauty salon logo (`~/Desktop/angelic-beauty-logo-favicon/angelic-beauty-logo-square.svg`):
the AB monogram with its leaf and four-point spark is unchanged, and the lettering reuses the original A, N, G, E, L, I, C, B
glyphs with a matching O and K drawn at the same 5-unit stroke, so it reads "ANGELIC BOOKING". Warm brown `#685E4F` is the
logo's own color; the app uses the brand purple `#6d28d9`.

| File | Use |
|---|---|
| `angelic-booking-logo-square.svg` / `-purple.svg` / `-white.svg` | Full lockup (mark above the lettering), brown / purple / white on brown. `png/*-2048.png` are renders. |
| `mark-brown.svg`, `mark-purple.svg` | Monogram only, transparent. Marketing masthead, booking-page footer. |
| `mark-white-on-purple.svg`, `mark-white-on-brown.svg` | Monogram on a rounded tile. App icons: `png/app-icon-512/192/180.png`. |
| `favicon-source.svg` | Tile with the lines thickened (stroke 7) so they survive at 16–32 px. `png/favicon-64/32/16.png`. |
| `png/google-consent-120.png` | Upload under the Google Cloud OAuth consent screen → App logo (120×120). |

Where it is wired in the app: `apps/web/src/components/brand.tsx` (`LogoMark`, header and auth pages), `apps/web/src/app/icon.svg`
(favicon), `apps/web/src/app/apple-icon.png`, `apps/web/public/favicon.ico` (16 + 32 px PNG-in-ICO for old user agents),
`apps/web/public/brand/*` (email footer mark and public copies), the booking page footer (`app/book/[slug]/layout.tsx`).
The marketing site copies what it needs into its own `assets/`.

To regenerate the PNGs on a Mac: `qlmanage -t -s <size> -o png <file>.svg`.
