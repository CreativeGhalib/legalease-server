# LegalEase — Operations Runbook

## Error monitoring (Sentry)
1. Create a project at sentry.io (free tier), copy the DSN.
2. Server: set `SENTRY_DSN` in Vercel env → redeploy. Any unhandled 5xx is captured
   automatically with the request correlation id (see `errorHandler`).
3. Client: set `VITE_SENTRY_DSN` in Vercel env → rebuild. Runtime errors caught by
   the app error boundary are reported.

## Uptime monitoring (UptimeRobot, free)
Create two HTTP monitors:
- `https://legalease-api.vercel.app/api/health` — expect 200, check every 5 min.
- `https://legalease-sand.vercel.app/` — expect 200, keyword `LegalEase`.

Alert contacts: owner email at minimum; add SMS only for the API monitor.

## Status page (Instatus stub)
Create an Instatus page mirroring the two monitors above and link it from the
Contact page when public status communication becomes necessary.

## Paging honesty
Nothing here pages a human at night. Alerts are email-only; treat any
UptimeRobot incident on the API monitor as same-day-response severity.
