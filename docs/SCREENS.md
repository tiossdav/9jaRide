# 9jaRide Pro: screens and navigation inventory

Written 2026-10-10 from the code (`android/rider`, `android/driver`, `admin/src/App.tsx`), not from a design file. It lists every screen the
apps and the admin portal actually contain, how it is reached, and where it stands. "Server" means it reads and writes the real backend;
"demo" means the driver app's offline demo mode (`-PdemoMode=true`) fakes it. Status words:

- **Complete**: wired to the server and covered by at least one automated test somewhere behind it.
- **Working, untested screen**: wired to the server, but the screen itself has no automated test (the backend behind it does).
- **Needs a real-device check**: depends on a phone, the Paystack/Termii/Mapbox accounts, or the camera and GPS, which cannot be proven in tests.

No screen below is a pure placeholder. There are no dead buttons that I found; where a feature is a deliberate gap it is listed under "Missing".

## Rider app (`android/rider`)

Navigation is a stack of `Dest` values in `RiderViewModel`; the home screen has three tabs (Home, Trips, Account).

| Screen | Dest / entry | Status | Backend |
|---|---|---|---|
| Splash | `Splash` (first) | Complete. White background, green 9. | `GET /app/config` wake-up |
| Welcome | `Welcome` | Working | none |
| Sign up (name + number) | `SignUp` | Complete. Refuses a number that already has an account before sending any code. | `POST /auth/otp/request` (`purpose: signup`) |
| Sign in | `SignIn` | Complete | `POST /auth/otp/request` |
| Code entry | `Otp` | Complete. Resend after a countdown; voice call option. | `POST /auth/otp/verify`, `/auth/register` |
| Location permission | `LocationPermission` | Needs a real-device check | none |
| Home (map, where to, ride options) | `Main`, tab 0 | Working. Map is Mapbox; before the first GPS fix it shows all of Nigeria, never a city. | `GET /maps/*`, `GET /app/home-content` |
| Where to / pickup | `WhereTo` | Working. Search is Nigeria-wide, nearest first. | `GET /maps/places`, `/maps/reverse` |
| Set on map | `SetOnMap` | Working | `GET /maps/reverse` |
| Choose a ride (fare, category, payment) | `SelectRide` | Complete | `POST /rides/quote`, `POST /rides` |
| Wallet hold prompt | `WalletHold` | Working | wallet endpoints |
| Schedule a ride | `ScheduleForm`, `ScheduleConfirm` | Complete | `POST /rides/scheduled` and related |
| Ride in progress (searching, driver coming, in transit, edit drop-off, SOS, chat) | overlay on top of everything | Complete (backend flow tests; screen needs a device check) | `/rides/*`, `/chat/*`, `/sos` |
| Trip complete, receipt, rating | overlay, `Receipt` | Complete | `/rides/:id`, `/rides/:id/rating` |
| Trips list | `Main`, tab 1 | Working | `GET /rides` |
| Trip details | `TripDetails` | Working | `GET /rides/:id` |
| Report a problem | `ReportProblem` | Working | `POST /support/*` |
| Account | `Main`, tab 2 | Working | `GET /me` |
| Wallet and activity | `Wallet` | Complete | `GET /wallet`, `/wallet/transactions` |
| Top up (any amount from ₦1,000) | `TopUp` | Complete. Needs a Paystack test run on a device. | `POST /wallet/topups` |
| Pay with Paystack (inside the app) | `Checkout` | Needs a real-device check | `GET /wallet/topups/:reference`, webhook |
| Personal details, Refer a friend, Help, Inbox, Delete account | `PersonalDetails`, `Refer`, `Help`, `Inbox`, `DeleteAccount` | Working (Inbox is a plain empty state: no inbox messages are built yet) | `/me`, `/support/*` |

## Driver app (`android/driver`)

Navigation is `Dest` plus a ride `Phase` (None, Offer, ToPickup, Waiting, InTrip, Collect, Rate, SosSent). Home has tabs.

| Screen | Dest / Phase | Status | Backend |
|---|---|---|---|
| Splash | `Splash` | Complete. Logo green, white 9. | none |
| Sign in / sign up, code entry | `SignIn`, `SignUp`, `Otp` | Complete | `/auth/otp/*`, `/auth/register` |
| Location permission | `LocationPermission` | Needs a real-device check | none |
| Application (5 steps: how you drive, about you, next of kin, vehicle, documents) | `Apply` | Complete. Insurance policy (number, expiry, photo) is required for a car the driver brings. Each document can be retaken or replaced from the gallery. | `POST /driver/application`, `/files` |
| Application status / update required | `ApplicationStatus`, `UpdateRequired` | Complete. Staff can ask for just one part or document; the rest stays filled in. | `GET /driver/application` |
| Vehicle arrangement terms | `Settlement` | Complete | `/driver/settlement*` |
| Home, online / offline, go-online checks | `Main`, `GoOnlineChecks` | Working; needs a device check (battery, background GPS) | `/driver/location`, `/driver/status` |
| Incoming ride request | Phase `Offer` | Complete | `GET /driver/offer`, `POST .../accept` |
| Heading to pickup (in-app navigation banner with the next turn) | Phase `ToPickup` | Working; turn instructions come from Mapbox | `/driver/rides/active`, `/maps/route` |
| Waiting for the rider | Phase `Waiting` | Working | `/driver/rides/:id/*` |
| Trip in progress (edit drop-off, chat, SOS) | Phase `InTrip` | Complete | same |
| End of trip: wallet trips show **Paid**, cash trips show **Cash collected** | Phase `Collect` | Complete | `POST /driver/rides/:id/complete` returns `paymentMethod`, `paymentStatus` |
| Rate the rider | Phase `Rate` | Complete | `POST /rides/:id/rating` |
| Earnings, wallet, **what you owe** | `Main`, earnings tab | Complete | `GET /wallet`, `GET /driver/debt` |
| Daily earnings, transactions, payout, bank account | `DailyEarnings`, `Transactions`, `Payout`, `BankAccountForm` | Complete | `/driver/trips`, `/wallet/*`, `/payouts` |
| Fund wallet (any amount from ₦1,000) + in-app Paystack page | `FundWallet`, `Checkout` | Complete; needs a Paystack test run on a device | `POST /wallet/topups` |
| Personal details, vehicle details, bonus, help, inbox, delete account | various | Working | `/driver/*` |
| SOS | Phase `SosSent` | Complete | `POST /sos` |

## Super-admin portal (`admin/`)

Routes from `admin/src/App.tsx`; side menu in `Layout.tsx`. All are wired to the server.

| Screen | Route | Status |
|---|---|---|
| Overview | `/` | Working |
| Live operations (Mapbox / OpenStreetMap map) | `/live` | Working; needs a map token for the Mapbox style |
| Safety centre, SOS detail | `/safety`, `/safety/:id` | Working |
| Customers (riders), people profile | `/customers`, `/people/:id` | Working |
| Drivers, onboarding review (documents approve / request update, including insurance) | `/drivers`, `/onboarding/:id` | Complete |
| Trips, trip detail | `/trips`, `/trips/:id` | Complete |
| Vehicles, businesses, fleet | `/vehicles`, `/fleet*` | Complete |
| Wallet overview, revenue, ledger, reconciliation, adjustments | `/finances/*` | Complete |
| Driver payouts | `/finances/payouts` | Complete |
| **Driver debts and recovery history** | `/finances/debts` | New. Read from the wallet ledger. |
| Vehicle plans, stakeholder payouts | `/finances/vehicle-plans*`, `/finances/stakeholders` | Complete |
| Pricing, asset types, revenue rules, cancellation, operating area, home cards | `/pricing`, `/setup/*` | Complete |
| Promos, support desk, activity log, team and roles | `/promo`, `/support*`, `/activity`, `/team*` | Complete |

## Missing or incomplete

- **iOS apps:** there is no iOS project in the repository. Nothing here has been built or tested for iOS.
- **Rider inbox messages**, **referral rewards**: empty states only.
- **Spoken turn-by-turn directions**: the driver's navigation banner is visual only.
- **A native card form:** payment is Paystack's own page, shown inside the app. The app never sees card details. A custom-styled card form would need Paystack's mobile SDK (a separate piece of work).
- **A "Send Text" button on the rider home screen:** none exists in the code. The closest thing is the "Send" ride option in the Ride options row. See the report.
- **A design canvas for the apps:** none is kept in the repository. This file is the inventory. The website canvas lives in a design file outside the repository.
