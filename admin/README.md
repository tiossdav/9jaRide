# 9jaRide admin portal

React + Vite + TypeScript, built from the "9jaRide Pro" admin design (AD, AO, AT, AU6 and AS screens). It talks to the backend over HTTP; the backend must list this site in `ADMIN_ORIGIN`.

## Run it

```
cd backend && npm run staff:create -- you@9jaridepro.com "Your Name" admin   # prints a password once; or set STAFF_PASSWORD
ADMIN_ORIGIN=http://localhost:5173 node dist/src/main.js                      # plus DATABASE_URL, JWT_SECRET
cd admin && npm install && npm run dev                                        # http://localhost:5173
```

`VITE_API_BASE` (see `.env.example`) points at the backend; it defaults to `http://localhost:3000`. `npm run build` type-checks and writes static files to `dist/`.

## What is built (all real data)

| Screen | Backend |
| --- | --- |
| Sign in (email + password) | `POST /auth/staff/login`, token refresh, sign out |
| Dashboard, Live operations (refreshes every 5 s) | `/admin/console/dashboard`, `/admin/console/live` |
| Safety Center, SOS detail (acknowledge, notes, resolve) | `/admin/console/safety`, `/admin/console/sos/:id`, `/admin/sos/:id/*` |
| Trips: overview, logs, trip detail with fare snapshot and "Refund or adjust" | `/admin/console/trips*`, `/admin/adjustments` |
| Drivers: overview, onboarding queue and review (approve, request changes, reject) | `/admin/console/drivers`, `/admin/driver-applications*` |
| Driver and customer profile with suspend, reinstate and wallet adjustment | `/admin/console/people/:id`, `/admin/users/:id/suspend`, `/admin/users/:id/reinstate` |
| Customers, Vehicles | `/admin/console/customers`, `/admin/console/vehicles` |
| Finances: Wallet overview, Driver payouts (approve, reject), Adjustments (request, approve, reject), Reconciliation (run, resolve exceptions) | `/admin/console/finance`, `/admin/payouts*`, `/admin/adjustments*`, `/admin/payment-exceptions*`, `/admin/reconciliation/run` |
| Team: members (invite, change role, switch off, reset password), member profile, Roles overview. Admin only | `/admin/team*` |
| Change password, and a forced change for new invitees | `POST /auth/staff/change-password` |
| **Setup:** Asset Types (add, rename, switch off), Revenue Setup (commission %, with or without tax, who shares it), Cancellation Policy (window, minimum trips, tiers). Rule changes are proposed with a start time and approved by a different admin | `/admin/asset-types`, `/admin/settings/*` |
| Stakeholder payouts: what each party is owed from the commission, request and approve payouts | `/admin/stakeholders*` |
| Promo: create and edit codes (percent or fixed, caps, limits, dates, categories), uses | `/admin/promos*` |
| Support: tickets raised from the apps, take, note, resolve with a reply the person sees, reopen | `/admin/support*` |
| Activity Logs (admin only) | `/admin/console/activity` |
| Trip Fees: live rates, version history, propose new fees, approve by a different admin, discard | `/admin/console/pricing*` |
| Finances: Revenue (by day, category, method) and Ledger (every transaction with its entries) | `/admin/console/revenue`, `/admin/console/ledger*` |
| Driver ratings, CSV export of trips and activity | `/admin/console/ratings`, `/admin/console/trips.csv`, `/admin/console/activity.csv` |

Support and admin staff can use the operations screens; finance and admin staff can use the money screens; only admin sees Activity Logs. Nobody can approve a payout or adjustment they requested themselves (the server enforces this).

## Not built yet

- **Two-step code at sign-in**: the backend has none. Inviting a team member shows a one-time password to the admin (no email is sent yet); the invitee must change it at first sign-in.
- **Custom roles**: the three roles (support, finance, admin) are enforced by the server, so the Roles page is read-only.
- **Bonus Rules, Bonus Awards and Referrals**: left out on purpose until the reward and bonus criteria are decided. They stay dimmed in the menu.
- Document viewing in onboarding: file upload is not built, so only the stored reference is shown.
- Support tickets have staff notes and a final reply; there is no back-and-forth chat with the rider or driver.

## Before launch

- Tokens live in `sessionStorage`; move to httpOnly cookies once the portal has its own domain.
- The live map uses OpenStreetMap tiles (light use only); use a paid provider.
- Serve `dist/` over HTTPS and set `ADMIN_ORIGIN` to that exact origin.
