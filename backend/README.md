# 9jaRide backend

NestJS modular monolith, first slice: **dispatch locking**, **money ledger**, **Safety Center (SOS)**.
Follows the "9jaRide Pro: Build-Ready Architecture" spec.

## Run

```
cp .env.example .env
docker compose up -d        # PostGIS + Valkey for local dev
npm install
npm run migrate
npm test
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
| Fare engine | Receipt lines always add up to the total (rounding is its own line); fare snapshot is immutable; rates are versioned data needing a second approver | `src/fare/`, `db/migrations/002_fare_engine.sql` |

Dev pricing (Comfort and Regular rates from the admin screens): `psql $DATABASE_URL -f db/seed/dev_pricing.sql`.

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

- Paystack client (`paystack.client.ts`) is written from the public docs and has **never been called against Paystack**, not even test keys; only the signature check is tested. With no `PAYSTACK_SECRET_KEY` it refuses every call and every webhook, so an unconfigured environment cannot move money.
- No HTTP route for the webhook yet. When it exists it must pass the raw request bytes to `PaymentsService.handleWebhook` (re-serialised JSON breaks the signature), answer 401 on `InvalidWebhookSignatureError` and 5xx on any other error.
- Bank account name verification, bank list, and payout destination management.

- Auth and HTTP controllers. The services take a user id as an argument; nothing is exposed over HTTP until the auth module exists.
- Real channels: Socket.IO gateway and FCM (offers), SMS and voice providers (SOS), Paystack webhooks. These are stubs behind interfaces that log a warning.
- Fare quotes, so the wallet hold amount is passed in by the caller for now.
- A dispatch/ledger integration test against real Postgres and Valkey. Payments has one (`payments.int.spec.ts`: `INTEGRATION=1 DATABASE_URL=... npm test -- payments.int`, writes to that database); the rest still mock both.
