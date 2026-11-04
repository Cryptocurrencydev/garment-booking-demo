# TIMELOG

| Phase | Start | End | Notes |
|---|---|---|---|
| 0. Setup & credentials | 10:55 | 11:03 | Square sandbox verified (Default Test Account, US/USD); Uber → mock; free OSM autocomplete; Resend absent → outbox |
| 1. Scaffold, schema, libs, API routes, UI | 11:03 | 11:17 | Next 16.4.5 + pg + Tailwind v4; Square REST client; Uber adapter (live + mock); notify adapters; home, booking flow, membership, confirmation, tracking, admin |
| 2. Typecheck + lint | 11:17 | 11:19 | route typegen; moved autocomplete out of effect |
| 3. Vitest (Square sandbox live + Uber mock + local PG) | 11:19 | 11:20 | 34/34 pass in 25s; 1 test-query fix |
| 4. Playwright e2e (390px + 1280px) + fixes | 11:20 | 12:14 | 16/16 pass; fixed membership idempotency-key reuse on card update, expected business errors now 200 ok:false (no browser console errors), email preview no iframe; Square iframe's own mobile CSP notice allow-listed |
| 5. Deploy (GitHub, Vercel, Neon, webhooks) | 12:07 | | |
