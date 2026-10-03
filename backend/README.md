# 9jaRide backend

NestJS modular monolith, first slice: **dispatch locking**, **money ledger**, **Safety Center (SOS)**.
Follows the "9jaRide Pro: Build-Ready Architecture" spec.

## Run

```
cp .env.example .env        # then set JWT_SECRET (32+ random characters)
docker compose up -d        # PostGIS + Valkey for local dev
npm install
npm run migrate
npm test
npm run staff:create -- you@example.com "Your Name" admin   # staff are never created over HTTP
npm run start:dev
```

## What is here

| Module | Guarantee | Where |
| --- | --- | --- |
| Dispatch | One ride never goes to two drivers; one driver never gets two offers | `src/dispatch/dispatch.service.ts` (`acceptOffer`, `offerTo`); partial unique index `rides_one_active_per_driver` |
| Ledger | Append-only, double-entry, integer kobo, idempotent posting, balances derived | `db/migrations/001_core.sql`, `src/ledger/` |
| Safety | An SOS is confirmed only after it is stored; unacknowledged after 60 s phones on-call | `src/safety/sos.service.ts` |
| Payments | A wallet is credited only after we ask Paystack and the amount matches; redelivered webhooks never double-credit; a missed webhook is recovered hourly | `src/payments/payments.service.ts`, `reconciliation.service.ts` |
| Payouts | Money leaves the wallet at request time; a second person must approve; a transfer is claimed before it is sent, under a stable reference; an unknown outcome is never refunded blindly | `src/payments/payouts.service.ts`, `db/migrations/003_payments.sql` |
| Auth | Every route needs a token unless marked `@Public()`; one-time codes are hashed, single-use and attempt-limited; refresh tokens rotate and a replayed one revokes the login | `src/auth/` |
| Fare engine | Receipt lines always add up to the total (rounding is its own line); fare snapshot is immutable; rates are versioned data needing a second approver | `src/fare/`, `db/migrations/002_fare_engine.sql` |

Dev pricing (Comfort and Regular rates from the admin screens): `psql $DATABASE_URL -f db/seed/dev_pricing.sql`.

## HTTP API

Everything needs `Authorization: Bearer <access token>` except the routes marked public. Creating things needs an `Idempotency-Key` header (one per user action, re-sent on every retry). Roles: `rider`, `driver`, and staff `support`, `finance`, `admin`.

| Who | Routes |
| --- | --- |
| Public | `POST /auth/otp/request`, `/auth/otp/verify`, `/auth/register`, `/auth/refresh`, `/auth/logout`, `/auth/staff/login`; `GET /health`; `POST /webhooks/paystack` (signature is the login) |
| Any signed-in user | `GET /me`, `POST /auth/logout-all`, `GET /rides/:id`, `GET /rides/:id/receipt` (own rides only; staff see all) |
| Rider | `POST /rides/quote`, `POST /rides` |
| Driver | `POST /driver/location`, `/driver/rides/:id/accept` `decline` `arrive` `start` `complete`, `POST /payouts`, `GET /payouts` |
| Rider and driver | `GET /wallet`, `POST /wallet/topups`, `POST /sos`, `POST /sos/:id/location` |
| Finance, admin | `GET /admin/payouts`, `POST /admin/payouts/:id/approve` `reject`, `GET /admin/reconciliation/findings`, `POST /admin/reconciliation/run` |
| Support, admin | `GET /admin/sos`, `POST /admin/sos/:id/acknowledge` `assign` `notes` `resolve`, `GET /admin/sos/:id/timeline` |

Sign-in: request a code, verify it. A number with no account gets `422 registration_required` with a `registrationTicket`; the app then calls `/auth/register` with the ticket, a role and a name (no second SMS). Staff changes are written to `staff_audit_log`.

HTTP tests run the real app against Postgres and Valkey with only SMS and Paystack faked: `INTEGRATION=1 DATABASE_URL=... npm test -- http.int` (writes to that database).

## Auth and HTTP decisions I made (change any of them)

- **Phone OTP for riders and drivers, password for staff.** Codes are 6 digits, valid 5 minutes, 5 wrong guesses lock a code, 3 requests per number per 10 minutes, 10 per day, 20 per source address per hour. Placeholders until agreed.
- **Access tokens last 15 minutes, refresh tokens 30 days** (staff: 12 hours). A suspension takes effect at the next refresh, up to 15 minutes later, not instantly.
- **Staff lock for 15 minutes after 5 wrong passwords.** No two-factor for staff yet; add it before real money moves.
- **Role is fixed at registration.** A rider cannot become a driver by signing in differently.
- **Another person's ride is a 404, not a 403**, so ride ids cannot be probed.
- **A wallet ride holds the top of the quoted range** when it is requested, in the same transaction as the ride. No funds means no ride (402). The hold is released if no driver is found. Releasing it on rider or driver cancellation is not built, because cancellation is not built.
- **A driver's category comes from their active vehicle**, cached for 5 minutes, never from the request.

## Bug fixed on the way

A driver on a trip who kept sending location pings was put back in matching as `available` on every ping (the ping always wrote `status: available`). It now keeps `on_trip` until the trip completes.

## Fare engine decisions I made (change any of them)

- **Commission base excludes the ₦30 tax.** 12% is taken on the fare minus tax; tax goes to `platform:tax`. A cash-trip driver owes commission plus the tax they collected. Confirm with your accountant.
- **Estimate band** is 85% to 110% of the expected fare, a placeholder. The sample range (₦1,828 to 2,400 on about ₦2,257) suggests roughly 81% to 106%.
- **Fare above the quoted range** is charged as computed and flagged `outside_quote_range`, not capped. The cap is still an open decision.
- **Waiting fee and free window** are 0 in the seed because no screen shows them.
- **Tax is per trip** until your accountant confirms it is not per driver per day.

## Payments and payouts decisions I made (all placeholders, change any of them)

- **Top-up limits** ₦100 to ₦500,000 (`TOPUP_MIN_KOBO`, `TOPUP_MAX_KOBO`). **Minimum payout** ₦1,000 (`PAYOUT_MIN_KOBO`). Finance has not set these.
- **Every payout needs a second approver**, with no amount threshold. The requester can never approve (service check plus a database CHECK). Approvers are plain ids until the staff/auth module exists.
- **Ledger flow for a payout:** request moves wallet -> `platform:payout`; paid moves `platform:payout` -> `platform:cash`; failed or rejected moves it back to the wallet. A driver whose cash commission debt has taken the wallet negative cannot withdraw.
- **A transfer the provider never received** is refunded after 30 minutes (`PAYOUT_STUCK_SECONDS`). A transfer with an unknown outcome stays `PROCESSING` and is never refunded until the provider says so.
- **Paystack needs an email**, riders only have a phone, so top-ups use `<phone digits>@example.invalid` (`PAYMENT_EMAIL_DOMAIN`). Replace once emails are collected.
- **Reconciliation** runs hourly over the last 25 hours, takes a Postgres advisory lock so only one instance runs, and records runs and findings in `reconciliation_runs` / `reconciliation_findings`. It only auto-completes a paid-but-uncredited top-up and a settled payout; anything else (unknown reference, amount mismatch, credit the provider cannot confirm, stuck or paid-after-failed payout, ledger imbalance) is a finding for a person. Nothing reads findings yet: no admin screen or alert.
- **Bank details** are stored as plain text on the payout row. Encrypt them before real use.

## Not built yet

- **The driver supplies the trip's distance and time** when completing a trip. There is no server-side trip tracking, so an inflated figure is caught only by the quote-range flag (`outside_quote_range`), not prevented. Same for the rider's quote: the distance comes from the app. Compute both server-side from the location pings and a routing service.
- Rider/driver cancellation, driver-initiated no-show, ride history lists, driver earnings screens, vehicle and document onboarding, staff-managed pricing versions, refunds and adjustments with a second approver.
- Rate limiting beyond sign-in (a general per-user/IP limiter backed by Valkey), request logging, and metrics.
- A real SMS/voice provider for codes. Outside production the code is written to the log; in production sending fails until a provider is wired in.

- Paystack client (`paystack.client.ts`) is written from the public docs and has **never been called against Paystack**, not even test keys; only the signature check is tested. With no `PAYSTACK_SECRET_KEY` it refuses every call and every webhook, so an unconfigured environment cannot move money.
- Bank account name verification, bank list, and payout destination management.

- Real channels: Socket.IO gateway and FCM (offers), SMS and voice providers (SOS), Paystack webhooks. These are stubs behind interfaces that log a warning.
- Fare quotes, so the wallet hold amount is passed in by the caller for now.
- A dispatch/ledger integration test against real Postgres and Valkey. Payments has one (`payments.int.spec.ts`: `INTEGRATION=1 DATABASE_URL=... npm test -- payments.int`, writes to that database); the rest still mock both.
