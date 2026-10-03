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

## Not built yet

- Auth and HTTP controllers. The services take a user id as an argument; nothing is exposed over HTTP until the auth module exists.
- Real channels: Socket.IO gateway and FCM (offers), SMS and voice providers (SOS), Paystack webhooks. These are stubs behind interfaces that log a warning.
- Fare quotes, so the wallet hold amount is passed in by the caller for now.
- An integration test that fires concurrent accepts and duplicate postings at real Postgres and Valkey. The unit tests mock both, so they check decision logic only.
