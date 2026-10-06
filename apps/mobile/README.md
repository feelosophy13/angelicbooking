# Angelic Booking — mobile (Expo)

Staff app: sign in, see the day's agenda for your business, open an appointment and
change its status. Talks to the web app's `/api/mobile/*` routes using the Better Auth
session as a Bearer token (via `@better-auth/expo`).

```bash
pnpm --filter @angelic/mobile install   # first time (Expo SDK 54)
pnpm --filter @angelic/mobile ios       # or `start` and scan with Expo Go
```

Point `extra.apiUrl` in `app.json` at your running web app (the iOS simulator can reach
`http://localhost:3001`; a physical phone needs your machine's LAN IP or a deployed URL).

Roadmap: checkout screen, Tap to Pay via `@stripe/stripe-terminal-react-native` on the
business's connected account, push notifications for new online bookings.
