# TIMELOG

| Phase | Start | End | Notes |
|---|---|---|---|
| 0. Setup & credentials | 10:55 | 11:03 | Square sandbox verified (Default Test Account, US/USD); Uber → mock; free OSM autocomplete; Resend absent → outbox |
| 1. Scaffold, schema, libs, API routes, UI | 11:03 | 11:17 | Next 16.4.5 + pg + Tailwind v4; Square REST client; Uber adapter (live + mock); notify adapters; home, booking flow, membership, confirmation, tracking, admin |
| 2. Typecheck + lint | 11:17 | 11:19 | route typegen; moved autocomplete out of effect |
| 3. Vitest (Square sandbox live + Uber mock + local PG) | 11:19 | 11:20 | 34/34 pass in 25s; 1 test-query fix |
| 4. Playwright e2e (390px + 1280px) + fixes | 11:20 | 12:07 | 16/16 pass; fixed membership idempotency-key reuse on card update, expected business errors now 200 ok:false (no browser console errors), email preview no iframe; Square iframe's own mobile CSP notice allow-listed |
| 5. Deploy (GitHub, Vercel, Neon, webhooks) | 12:07 | 12:21 | gitleaks clean; public repo; vercel link (git-connected); Neon via Marketplace + schema; Square webhook subscription + env vars; Square test event verified 200 |
| 6. Live verification + fix | 12:21 | 12:36 | Live e2e found Square deactivating subscriptions for @example.com customers (no invoice). Switched test emails to a deliverable domain, added ACTIVE+invoice assertion and owner alert on DEACTIVATED. Live e2e 16/16; real invoice.payment_made webhooks recorded |

**Total: 10:55 → 12:36 (~1h41m)**
| 7. Live payment bug: repro + fix + redeploy | 12:42 | 12:56 | Phone 432-098-2220 (exchange starts with 0) passed our 10-digit check, Square /v2/customers rejected INVALID_PHONE_NUMBER before payment → unhandled → 500 'Something went wrong'. Fix: NANP validation on form + API, inline hint, Square customer retried without phone, Square customer errors mapped to friendly messages. Vitest 49/49; live e2e 18/18 |
