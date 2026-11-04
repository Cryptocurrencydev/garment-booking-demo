# Marlowe & Finch: garment care booking (demo)

A mobile-first booking app for a neighbourhood dry cleaner. Customers can:

1. **Schedule a pickup**: an Uber courier collects garments from their door and brings them to the shop.
2. **Schedule a delivery**: an Uber courier brings cleaned garments from the shop to their door.
3. **Subscribe to a monthly membership**: billed through Square, with free courier runs and 15% off.

At checkout the customer sees the real-time Uber delivery fee and ETA for their exact address. They pay with Square, using either a new card or the card on file in one tap. The courier is then dispatched automatically. The customer gets a confirmation, and the owner gets a notification and a password-protected `/admin` dashboard.

> Marlowe & Finch is a fictional brand. All payments run in the **Square sandbox**. Uber Direct runs in **"sandbox pending" mode**, a realistic mock behind the same adapter, until sandbox credentials are added.

Demo by [DC Tech](https://dctechltd.com)

---

## Architecture

```
Next.js 16 (App Router, TypeScript, Tailwind v4) on Vercel
├── src/app                     pages: / · /book/[pickup|delivery] · /membership · /confirmation/[ref] · /track/[ref] · /admin
│   └── api/
│       ├── address             free autocomplete (OpenStreetMap Photon), biased to the shop
│       ├── quote               Uber quote for the exact address + window → stored server-side
│       ├── checkout            idempotent: customer → card on file → Square payment → Uber dispatch → notify
│       ├── membership/*        subscribe · cancel · update card (Square Subscriptions)
│       ├── track/[ref]         live courier status (also advances the mock)
│       └── webhooks/{square,uber}   signature-verified, de-duplicated by event id
├── src/lib
│   ├── square.ts               thin Square REST client (payments, cards, customers, catalog, subscriptions, webhook HMAC)
│   ├── uber/                   UberDirect interface → live.ts (real API) | mock.ts ("sandbox pending")
│   ├── bookings.ts             pricing, quotes, checkout, dispatch, Uber status handling
│   ├── memberships.ts          subscribe/cancel/card update + Square webhook handling
│   ├── notify.ts               email (Resend) / SMS (Twilio) adapters → outbox table when no keys
│   └── config.ts               store address, hours, price list, membership plan
└── db/schema.sql               Postgres (Neon): customers, quotes, bookings, delivery_events,
                                memberships, payments, webhook_events, notifications, settings
```

The client never sends a price. The server reloads the stored quote and recomputes the totals from the price list. Card data stays in Square's PCI iframe, and the app only ever handles a single-use token.

## Uber Direct flow

| Step | What happens |
|---|---|
| Address entered | `POST /api/quote` → `POST /v1/customers/{id}/delivery_quotes` with structured pickup/dropoff addresses and coordinates. The fee and ETA appear before the customer chooses a time. |
| Window chosen | Re-quoted with `pickup_ready_dt`/`pickup_deadline_dt` (pickup) or `dropoff_ready_dt`/`dropoff_deadline_dt` (delivery), so the price matches the window. |
| Pay | If the quote has expired (15 min) or the window changed, the server re-quotes. If the fee went **up**, the customer must accept the new fee before being charged. |
| Dispatch | After payment: `POST /v1/customers/{id}/deliveries` with the quote id, both stops, manifest and `external_id` = booking ref. The delivery id and `tracking_url` are stored. |
| Status | `POST /api/webhooks/uber` verifies `x-uber-signature` (HMAC-SHA256 of the raw body), drops duplicate event ids, ignores out-of-order statuses and applies `pending → pickup (courier assigned) → pickup_complete (picked up) → dropoff → delivered`, or `canceled`/`returned`. The customer is texted when a courier is assigned and emailed on delivery. The owner is emailed on cancel. |
| Dispatch failure | Payment is already captured, so the booking is flagged `dispatch_failed`, the owner is emailed, and `/admin` has a **Retry Uber dispatch** button. |

Direction: **pickup** = customer → shop, **delivery** = shop → customer. The shop address, hours, window length, lead time and service radius are in `src/lib/config.ts`.

**Mock ("Uber Direct sandbox pending")**: active while the `UBER_*` env vars are empty.
- Pricing: $5.99 base + $1.15/road-mile, $6.99 minimum, +$1.50 after 5 pm.
- ETA comes from distance. Addresses more than about 12 miles out are rejected as `address_undeliverable`.
- Status changes play out over about 5 minutes. They are sent as **signed webhook events through the same handler** the real API uses.
- Going live means setting `UBER_CUSTOMER_ID`, `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET` and `UBER_WEBHOOK_SIGNING_KEY`, then pointing the Uber webhook at `/api/webhooks/uber`.

## Square flow

- **One-time payment**: the Web Payments SDK card form produces a token → `POST /v2/payments` (service estimate − member discount + Uber fee) with `reference_id` = booking ref.
- **Card on file**:
  - The Square customer is found by email, or created.
  - With "save card" ticked, the token goes to `POST /v2/cards` and the payment uses the `ccof:` card id.
  - A signed, httpOnly "remembered device" cookie lets returning customers pay with one tap (**Pay $X · Visa 1111**).
  - Saved-card checkout is refused without that cookie.
- **Memberships**:
  - A `SUBSCRIPTION_PLAN` + monthly `SUBSCRIPTION_PLAN_VARIATION` ($59, static price) is created once in the catalog. Its ids are cached in `settings`.
  - Subscribe: card on file → `POST /v2/subscriptions`.
  - Cancel: `POST /v2/subscriptions/{id}/cancel` ends the plan at the end of the billing period.
  - Update card: new card on file → `PUT /v2/subscriptions/{id}` with the new `card_id`.
- **Webhooks**: `POST /api/webhooks/square` verifies `x-square-hmacsha256-signature` (base64 HMAC-SHA256 of *notification URL + raw body*) and de-duplicates by `event_id`.
  - `invoice.payment_made` → membership active + payment row.
  - `invoice.scheduled_charge_failed` → `past_due` + "update your card" email to the member + owner alert.
  - `subscription.updated` → keeps status and dates in sync.
  - `payment.updated` → payment status.
- **Idempotency**: each checkout attempt has a client UUID. Every Square call uses a key derived from it (`sha256(attempt:purpose)`, which fits within 45 characters). Bookings and memberships are unique on that key, so double taps and retries never double-charge. A failed attempt rotates the key.

## Notifications

On every booking, the customer gets an email (and an SMS if Twilio is configured), and the owner gets an email (and an SMS if `OWNER_PHONE` is set). New members, cancellations, failed membership payments, courier assigned, delivered and courier canceled also trigger messages.
- Email is sent with Resend when `RESEND_API_KEY` is set. Test mode sends from `onboarding@resend.dev`, and Resend only delivers to the account owner's address until a domain is verified.
- SMS is sent with Twilio when `TWILIO_*` are set.
- Without keys, every message is written to the `notifications` table. It appears in **/admin → Notifications**, and the customer's email is previewed on the confirmation page.

## What the owner needs to set up

1. **Square account** (free). Developer app → copy the production Application ID, Access Token and Location ID. Add a webhook subscription to `https://<domain>/api/webhooks/square` for `invoice.payment_made`, `invoice.scheduled_charge_failed`, `subscription.created`, `subscription.updated`, `payment.updated`, then copy the signature key. Set `SQUARE_ENVIRONMENT=production`.
2. **Uber Direct business account**: apply at [direct.uber.com](https://direct.uber.com) and complete the business verification. In the Developer tab, copy the Customer ID, Client ID and Client Secret, add a webhook to `https://<domain>/api/webhooks/uber`, and copy the signing key.
3. **Resend** (optional): verify the shop's domain to send from it. **Twilio** (optional): a number plus A2P 10DLC registration for US texting.
4. Set `ADMIN_PASSWORD`, `SESSION_SECRET`, `OWNER_EMAIL`, `OWNER_PHONE`, `APP_URL` in Vercel.
5. Edit `src/lib/config.ts` with the real address, coordinates, hours, price list and membership price.

## Monthly running costs (estimates; check current pricing)

| Item | Cost |
|---|---|
| Vercel | $0 Hobby for the demo; **Pro $20/mo** for a commercial site |
| Neon Postgres | $0 free tier is plenty for one shop (paid plans from about $19/mo if needed) |
| Square | No monthly fee. Online card processing about **2.9% + 30¢** per payment; subscriptions use the same rate |
| Uber Direct | No monthly fee. Per-delivery fee (typically about $6–12 locally) is passed to the customer at checkout, or covered for members |
| Resend | $0 up to 3,000 emails/mo (Pro $20/mo beyond) |
| Twilio SMS (optional) | About $1–2/mo for the number, plus 10DLC fees and about $0.01 per text |
| Domain | About $1/mo |
| **Typical total** | **about $20–25/mo fixed** + per-transaction Square fees (Uber fees are paid by customers) |

## Running locally

```bash
npm install
createdb garment_dev && DATABASE_URL=postgres://localhost/garment_dev npm run db:migrate
cp .env.example .env.local   # add Square sandbox keys
DATABASE_URL=postgres://localhost/garment_dev npm run dev
```

Sandbox test card: `4111 1111 1111 1111`, any future expiry, CVV `111`, ZIP `07042`. Use CVV `911` to trigger a decline.

> Square deactivates subscriptions whose customer email is undeliverable (for example `@example.com`), and it does so without creating an invoice. Use a real-looking email when testing memberships.

## Tests

```bash
createdb garment_test && DATABASE_URL=postgres://localhost/garment_test npm run db:migrate
npm test                     # vitest: live Square sandbox + Uber mock + local Postgres
createdb garment_e2e && DATABASE_URL=postgres://localhost/garment_e2e npm run db:migrate
npm run build && npm run test:e2e         # Playwright at 390px and 1280px, fails on any console error
BASE_URL=https://<live-url> npx playwright test   # same suite against production
```

Coverage:
- **Quote → pay → dispatch**: the happy path, checked against Square's own payment record.
- **Statuses and webhooks**: courier status through to delivered, plus signature checks, duplicate and out-of-order events.
- **Card on file and declines**: one-tap repeat checkout, declined cards.
- **Quote edge cases**: re-pricing when a quote expires, out-of-area addresses.
- **Memberships**: subscription create, update card, cancel, paid and failed invoice webhooks.
- **Admin and endpoints**: admin auth, and unsigned webhook rejection.
