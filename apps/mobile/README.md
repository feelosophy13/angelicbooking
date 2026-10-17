# Angelic Booking — mobile (Expo)

Staff app: sign in, see the day's agenda for your business, open an appointment and
change its status. Talks to the web app's `/api/mobile/*` routes with the Better Auth
session (the `@better-auth/expo` client keeps the session cookie in SecureStore and sends
it back on each request).

```bash
pnpm install                            # from the repo root, first time (Expo SDK 54)
pnpm dev                                # the web app on http://localhost:3001, in another terminal
pnpm --filter @angelic/mobile ios       # or `start` and scan with Expo Go
```

## Which server the app talks to

`app.config.ts` sets `extra.apiUrl` when the app is started or built:

| Situation | Server |
| --- | --- |
| `EXPO_PUBLIC_API_URL` is set | that URL |
| EAS build with the `production` profile, or `NODE_ENV=production` | `https://app.angelicbooking.com` |
| anything else (`expo start`, simulators) | `http://localhost:3001` |

The iOS simulator can reach `localhost`. A physical phone or the Android emulator cannot; use
your machine's LAN address (or `10.0.2.2` on the Android emulator):

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:3001 pnpm --filter @angelic/mobile start
```

The value is read when Metro starts, so restart `expo start` after changing it. For EAS builds,
set `EXPO_PUBLIC_API_URL` in the build profile's `env` (eas.json) or as an EAS environment
variable if a profile should point somewhere other than the default above.

## Signing in

Sign in with the email and password of a staff login on that server (an owner, manager, provider
or front-desk member of a business). The app only has email + password: there is no Google button
and no two-factor code screen yet, so a login with two-factor turned on can't sign in here. The
app shows the first business the login belongs to.

Locally, the demo tenants from `apps/web/scripts/seed-demo.ts` (`pnpm demo:refresh`) work; their
logins are in that script.

The server must trust the app's origin: `trustedOrigins` in `apps/web/src/lib/auth.ts` allows
`angelic://` always and, outside production, `exp://` (Expo Go / dev client). So a dev build
running in Expo Go can sign in to a local server but not to production; use a store or
`production`-profile build against production.

Roadmap: checkout screen, Tap to Pay via `@stripe/stripe-terminal-react-native` on the
business's connected account, push notifications for new online bookings.
