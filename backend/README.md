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
| Admin | Drivers reach dispatch only through a reviewed application; every manual money movement needs a second person; a wrong-amount payment is corrected only against what Paystack really collected | `src/admin/`, `db/migrations/005_admin.sql` |
| Scheduled rides | A booking is real rides in `SCHEDULED`; each is priced with the rates in force when dispatch starts, and wallet money is held then, not at booking; a missed ride is cancelled, never started late | `src/rides/scheduled-rides.service.ts`, `db/migrations/006_*` |
| Driver location | A driver appears on the map only for a fresh reading; an offline batch is stored once; a driver on a trip stays out of matching even after losing signal; a reported distance far above the recorded route is flagged | `src/rides/location.service.ts` |
| Fare engine | Receipt lines always add up to the total (rounding is its own line); fare snapshot is immutable; rates are versioned data needing a second approver | `src/fare/`, `db/migrations/002_fare_engine.sql` |

Dev pricing (Comfort and Regular rates from the admin screens): `psql $DATABASE_URL -f db/seed/dev_pricing.sql`.

## HTTP API

Everything needs `Authorization: Bearer <access token>` except the routes marked public. Creating things needs an `Idempotency-Key` header (one per user action, re-sent on every retry). Roles: `rider`, `driver`, and staff `support`, `finance`, `admin`.

| Who | Routes |
| --- | --- |
| Public | `GET /app/config` (send `X-App-Platform` and `X-App-Version`), `POST /auth/otp/request`, `/auth/otp/verify`, `/auth/register`, `/auth/refresh`, `/auth/logout`, `/auth/staff/login`; `GET /health`; `POST /webhooks/paystack` (signature is the login) |
| Any signed-in user | `GET /me`, `POST /auth/logout-all`, `GET /rides/:id`, `GET /rides/:id/receipt` (own rides only; staff see all) |
| Rider | `POST /rides/quote`, `POST /rides`, `POST /rides/:id/cancel`, `POST /ride-schedules`, `GET /ride-schedules`, `POST /ride-schedules/:id/cancel` |
| Driver | `POST /driver/application`, `GET /driver/application`, `POST /driver/location`, `POST /driver/location/batch`, `/driver/rides/:id/accept` `decline` `arrive` `start` `complete`, `POST /payouts`, `GET /payouts` |
| Rider and driver | `GET /wallet`, `POST /wallet/topups`, `POST /sos`, `POST /sos/:id/location` |
| Support, finance, admin | `POST /admin/adjustments` (ask for a refund, credit, debit or top-up correction), `GET /admin/adjustments`, `GET /admin/adjustments/:id` |
| Finance, admin | `POST /admin/adjustments/:id/approve` `reject`, `GET /admin/payment-exceptions`, `POST /admin/payment-exceptions/resolve`, `GET /admin/payouts`, `POST /admin/payouts/:id/approve` `reject`, `GET /admin/reconciliation/findings`, `POST /admin/reconciliation/run` |
| Support, finance, admin | `GET /admin/trip-checks`, `POST /admin/trip-checks/:rideId/review` |
| Admin | `GET /admin/app-config`, `PUT /admin/app-config` |
| Support, admin | `GET /admin/driver-applications`, `GET /admin/driver-applications/:id`, `POST` `.../approve` `request-changes` `reject`, `POST /admin/users/:id/suspend` `reinstate`, `GET /admin/sos`, `POST /admin/sos/:id/acknowledge` `assign` `notes` `resolve`, `GET /admin/sos/:id/timeline` |

Sign-in: request a code, verify it. A number with no account gets `422 registration_required` with a `registrationTicket`; the app then calls `/auth/register` with the ticket, a role and a name (no second SMS). Staff changes are written to `staff_audit_log`.

HTTP tests run the real app against Postgres and Valkey with only SMS and Paystack faked (they write to `DATABASE_URL`, so use a local dev database). Run them one suite at a time, because they share the database and Valkey and there is one global reconciliation lock: `INTEGRATION=1 DATABASE_URL=... npm run test:int`. Run in parallel they interfere with each other (a stray searching ride offers itself to another test's driver).

## Auth and HTTP decisions I made (change any of them)

- **Phone OTP for riders and drivers, password for staff.** Codes are 6 digits, valid 5 minutes, 5 wrong guesses lock a code, 3 requests per number per 10 minutes, 10 per day, 20 per source address per hour. Placeholders until agreed.
- **Access tokens last 15 minutes, refresh tokens 30 days** (staff: 12 hours). A suspension takes effect immediately: a flag in Valkey blocks the still-valid access token, and refresh and sign-in are refused.
- **Staff lock for 15 minutes after 5 wrong passwords.** No two-factor for staff yet; add it before real money moves.
- **Role is fixed at registration.** A rider cannot become a driver by signing in differently.
- **Another person's ride is a 404, not a 403**, so ride ids cannot be probed.
- **A wallet ride holds the top of the quoted range** when it is requested, in the same transaction as the ride. No funds means no ride (402). The hold is released if no driver is found. Releasing it on rider or driver cancellation is not built, because cancellation is not built.
- **A driver's category comes from their active vehicle**, cached for 5 minutes, never from the request.

## Admin decisions I made (change any of them)

- **Driver review:** a driver applies with a vehicle and documents; staff approve, ask for changes, or reject. The vehicle row dispatch uses is created only on approval, so there is no way onto the map without review. Required documents: driver's licence, vehicle papers, insurance (`REQUIRED_DOCUMENTS`); an expired one blocks approval. Support and admin review; finance cannot. File upload is not built: documents are storage keys (`fileRef`) the app would get from an upload service.
- **Refunds are paid by the platform, not taken from the driver.** A refund credits the rider from `platform:adjustments` and never touches the driver's earnings. Recovering money from a driver is a separate `debit` adjustment, which also needs approval. A refund cannot exceed the fare, in total, per ride.
- **Who decides:** support, finance and admin can ask; only finance and admin can approve, never the person who asked (service check plus a database CHECK). An amount over ₦50,000 (`ADJUSTMENT_ADMIN_THRESHOLD_KOBO`) needs an admin to approve. The limit is a placeholder.
- **A wrong-amount payment** (Paystack collected something different from what the rider asked for) is parked and never credited. Finance asks for a `topup_correction`; when it is approved the app asks Paystack again and the payment must have succeeded for exactly that amount. It uses the normal top-up ledger key, so a payment can never be credited twice, whichever way it is fixed first.
- **Payment exceptions** are one queue: wrong-amount top-ups, reconciliation findings (shown once, not once per hourly run) and failed payouts. Resolving records who decided what; it never moves money itself.
- **A driver's wallet can go negative on a debit adjustment** (commission debt); a rider's cannot.
- **Suspending** needs a reason, revokes sessions, removes the driver from the map and is written to `user_status_events`.

## Scheduled rides and driver location decisions I made (change any of them)

- **Booking:** one ride or a weekly series of 2 to 12 weeks. At least 30 minutes ahead and at most 30 days ahead for the first ride; at most 30 waiting rides per rider. "Same time next week" is exactly 7 days later (Lagos has no daylight saving). All placeholders in `.env.example`.
- **Price and money:** booking returns an indicative estimate only. The fare is worked out, and the pricing version pinned, when dispatch starts, so a rate change between booking and pickup applies. A wallet ride holds the top of the quoted range at that moment; if the wallet is short the ride is cancelled by the system with a reason. Rider notifications are a logging stub until push/SMS exist, so for now the rider only finds out by reading the ride.
- **Dispatch timing:** search starts 15 minutes before pickup and may run 10 minutes (on-demand rides keep their 90 seconds). A ride still waiting more than 10 minutes after its pickup time, for example because workers were down, is cancelled rather than started late.
- **Cancellation (new, for all rides):** a rider can cancel until the trip starts. It releases the wallet hold, withdraws any open offer, frees the driver and is safe to repeat. There is no cancellation fee yet. The driver is not told (no push); their app would see it when it next reads the ride. Cancelling a series cancels only the occurrences that have not started dispatch.
- **Offline location:** `POST /driver/location/batch` takes up to 100 readings, each with the time the phone took it. Only a reading under 30 seconds old puts a driver on the map; older ones are history. Spoofed (mock) readings, readings from the future (over 60 seconds, a wrong phone clock) and readings older than 24 hours are dropped and counted. Uploading the same batch twice stores it once.
- **A driver on a trip stays on a trip.** Pings used to reset a driver to `available` every time, and the 20-second presence record also expired when signal was lost. Both are fixed: the trip is tracked under its own key that outlives a gap in signal.
- **Trip distance check:** while a driver is on a trip their readings are kept. When they finish, the distance they report is compared with the recorded route (readings with accuracy over 50 m ignored, window padded 30 s before and 60 s after for phone clock error). Only a report more than 30% and 1 km above the route, with at least 10 readings, is flagged for staff. A flag never changes the fare. If the app is offline when the trip ends and uploads later, the check sees too few readings and passes. This narrows the "driver supplies the distance" gap; it does not close it.
- **`GET /app/config`** tells an app whether it must update (`forceUpdate`, compared as numbers), the driver location settings, battery-optimisation steps per phone brand, and the server time. Admins set minimum and latest versions per platform; the server refuses a minimum above the latest, or a forced minimum with no download link. It informs the app; the API does not itself reject old apps.

## What the phone app has to do (the native modules are NOT built)

The Kotlin (Android) and Swift (iOS) location modules are not in this repository, and I could not build or test them here: they need Android and iOS projects and real low-end phones. This is the contract the server is written for:

1. Read `GET /app/config` at start-up and obey `forceUpdate`.
2. While the driver is online, run a foreground service (Android, with a persistent notification) or background location (iOS), reading about every `movingIntervalSeconds` when moving and `idleIntervalSeconds` when still. Skip readings worse than `minAccuracyMeters`.
3. Stamp every reading with the time the phone took it (ISO 8601) and write it to an on-device queue first. Upload the queue to `POST /driver/location/batch` about every `batchUploadSeconds`, at most `batchMaxPoints` at a time, and delete only what the server accepted. Keep at most `bufferMaxPoints` and nothing older than `bufferMaxAgeHours`.
4. On reconnect, send the backlog oldest first. Resending is safe.
5. Report `mockLocation` honestly. Show the battery-optimisation steps from the config and detect when the app is being restricted.
6. Test on real Tecno, Infinix, itel, Samsung and Xiaomi phones: Android vendors stop background apps in different ways, and the steps in the config are written from general knowledge, not checked on devices.

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
- **Paystack needs an email**, riders only have a phone, so top-ups use `<phone digits>@pay.9jaridepro.com` (`PAYMENT_EMAIL_DOMAIN`). Replace once emails are collected.
- **Reconciliation** runs hourly over the last 25 hours, takes a Postgres advisory lock so only one instance runs, and records runs and findings in `reconciliation_runs` / `reconciliation_findings`. It only auto-completes a paid-but-uncredited top-up and a settled payout; anything else (unknown reference, amount mismatch, credit the provider cannot confirm, stuck or paid-after-failed payout, ledger imbalance) is a finding for a person. Nothing reads findings yet: no admin screen or alert.
- **Bank details** are stored as plain text on the payout row. Encrypt them before real use.

## Not built yet

- **The driver supplies the trip's distance and time** when completing a trip. The recorded route now flags a figure that is far too high (see above), and the quote-range flag still applies, but nothing prevents it. The rider's quote distance also comes from the app. Compute both server-side with a routing service.
- Native Kotlin and Swift location modules, a pruning job for `driver_location_points` (it grows while drivers are on trips), push notifications for offers and cancellations, and enforcing `forceUpdate` in the API.
- Driver cancellation and no-show, a cancellation fee, telling the driver when a rider cancels, ride history lists, driver earnings screens, document file upload and expiry reminders, staff-managed pricing versions (the second-approver rule is in the database; there is no screen or route), and a staff list/role management screen.
- Rate limiting beyond sign-in (a general per-user/IP limiter backed by Valkey), request logging, and metrics.
- A real SMS/voice provider for codes. Outside production the code is written to the log; in production sending fails until a provider is wired in.

- Paystack client (`paystack.client.ts`) is written from the public docs. Its requests and answers are tested against a stand-in for Paystack, but it has **not been called against Paystack itself**, not even with test keys; do that with `sk_test_` keys (TESTING.md, "Paystack") before going live. With no `PAYSTACK_SECRET_KEY` it refuses every call and every webhook, so an unconfigured environment cannot move money.
- Bank account name verification, bank list, and payout destination management.

- Real channels: Socket.IO gateway and FCM (offers), SMS and voice providers (SOS), Paystack webhooks. These are stubs behind interfaces that log a warning.
- Fare quotes, so the wallet hold amount is passed in by the caller for now.
- A dispatch/ledger integration test against real Postgres and Valkey. Payments has one (`payments.int.spec.ts`: `INTEGRATION=1 DATABASE_URL=... npm test -- payments.int`, writes to that database); the rest still mock both.
