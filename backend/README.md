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
| Fare engine | Receipt lines always add up to the total (rounding is its own line); fare snapshot is immutable; rates are versioned data needing a second approver | `src/fare/`, `db/migrations/002_fare_engine.sql` |

Dev pricing (Comfort and Regular rates from the admin screens): `psql $DATABASE_URL -f db/seed/dev_pricing.sql`.

## Fare engine decisions I made (change any of them)

- **Commission base excludes the ₦30 tax.** 12% is taken on the fare minus tax; tax goes to `platform:tax`. A cash-trip driver owes commission plus the tax they collected. Confirm with your accountant.
- **Estimate band** is 85% to 110% of the expected fare, a placeholder. The sample range (₦1,828 to 2,400 on about ₦2,257) suggests roughly 81% to 106%.
- **Fare above the quoted range** is charged as computed and flagged `outside_quote_range`, not capped. The cap is still an open decision.
- **Waiting fee and free window** are 0 in the seed because no screen shows them.
- **Tax is per trip** until your accountant confirms it is not per driver per day.

## Not built yet

- Auth and HTTP controllers. The services take a user id as an argument; nothing is exposed over HTTP until the auth module exists.
- Real channels: Socket.IO gateway and FCM (offers), SMS and voice providers (SOS), Paystack webhooks. These are stubs behind interfaces that log a warning.
- Fare quotes, so the wallet hold amount is passed in by the caller for now.
- An integration test that fires concurrent accepts and duplicate postings at real Postgres and Valkey. The unit tests mock both, so they check decision logic only.
