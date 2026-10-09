# Testing and debugging

Four kinds of test, from fastest to most realistic. Run the fast ones all the time and the slow ones before you ship.

| Kind | What it proves | Where | How to run |
| --- | --- | --- | --- |
| **Unit** | One small function is right (money rounding, fare maths, ledger postings, formatters, the HTTP client) | `backend/src/**/*.spec.ts` (not `.int.`), `admin/src/*.test.ts`, `android/core/src/test` | `cd backend && npm run test:unit` · `cd admin && npm test` · `cd android && ./gradlew :core:testDebugUnitTest` |
| **Component** | A screen piece behaves as a person would see it (the "are you sure" box, the change-password rules, the role-based menu) | `admin/src/*.test.tsx` (Testing Library), `android/core/src/androidTest` (Compose, needs a phone) | `cd admin && npm test` · `cd android && ./gradlew :core:connectedDebugAndroidTest` |
| **Integration / API** | The real server, real Postgres and Valkey, real HTTP: sign-in, rides, money, approvals, permissions | `backend/src/*.int.spec.ts` | `cd backend && npm run test:int` |
| **End-to-end** | A real browser drives the real admin portal against the real backend | `admin/e2e/*.spec.ts` (Playwright, uses your installed Chrome) | see below |

## Before you run anything

1. Postgres and Valkey/Redis are running (`docker compose up -d` in `backend/`), and `npm run migrate` has been run.
2. `npm run test:int` uses its **own** database, `jaride_test` (and Redis database 1), created and migrated automatically the first time. Test people and test money therefore never reach the database you use by hand. Override with `TEST_DATABASE_URL` / `TEST_REDIS_URL`.
3. The browser tests (below) create staff accounts in whichever database their backend uses. To keep your own database clean, start that backend with `DATABASE_URL=postgres://jaride:jaride@localhost:5432/jaride_test` and run `npm run e2e` with the same value.

## Everyday commands

```
cd backend
npm run test:unit          # fast, no database
npm run test:int           # whole API against the real database, one file at a time
npm run test:int -- src/team.int.spec.ts      # a single file
npm run test:cov           # unit tests with a coverage table
npm run test:cov:all       # everything with coverage

cd admin
npm test                   # unit and component tests (fast, no server)
npm run test:watch         # re-runs as you edit
npm run test:cov
npm run e2e                # browser tests (needs the backend running, see below)
npm run e2e:ui             # Playwright's visual runner: watch each step, rewind, inspect
```

### Running the browser tests

```
# terminal 1 (backend, with the admin site allowed)
cd backend && npm run build
DATABASE_URL=postgres://jaride:jaride@localhost:5432/jaride JWT_SECRET=any-long-random-string-at-least-32-chars ADMIN_ORIGIN=http://localhost:4173,http://localhost:5173 node dist/src/main.js

# terminal 2
cd admin && npm run e2e
```

The tests build the portal and serve it on port 4173 (like production would), so they do not depend on the dev server. The tests create their own staff accounts for the run (through `backend/scripts/create-staff.ts`) and never touch yours. A failing test leaves a screenshot, a trace and an `error-context.md` under `admin/test-results/`; open the trace with `npx playwright show-trace <trace.zip>` to step through what the browser did. The HTML report is `admin/playwright-report/`.

### Android

- Unit tests (`:core:testDebugUnitTest`) run on the computer.
- Component tests (`:core:connectedDebugAndroidTest`) run on a connected phone or emulator. Unlock the phone first.
- The full flow on a real phone is exercised by hand today: sign in, book, track, finish. See `android/README.md`.

## Debugging

Open the repo in VS Code. `.vscode/launch.json` has ready-made configurations (Run and Debug panel):

- **Backend: run and debug** starts the API with breakpoints working in the TypeScript.
- **Backend: attach** attaches to a process started with `npm run start:debug` (port 9229).
- **Backend: debug the current unit / integration test file** runs the open spec under the debugger. Put a breakpoint inside the code under test or in the spec.
- **Admin: debug in Chrome** opens the portal with source-mapped breakpoints (start `npm run dev` in `admin/` first).
- **Admin: debug the current component test file** runs the open `.test.tsx` under the debugger.

From a terminal: `cd backend && npm run test:debug -- src/some.spec.ts` pauses at start and waits for a debugger (Chrome: `chrome://inspect`). `cd admin && npm run e2e:debug` opens Playwright's step-by-step inspector.

Android: in Android Studio, open the `android/` folder, choose the `rider` or `driver` configuration, and press the bug icon. Logs: `adb logcat | findstr ninejaride`.

## What the tests have already caught

- A confirmation box that closed as if an action had worked when the server had refused it (a page caught the error before the box could show it).
- The same-start-time rule on fee changes (two versions cannot start at the same moment).
- Dev servers disturbing integration runs that share a database.
- A default 5-second test timeout that the heavier API tests outgrew as the database filled up (now 30 seconds).
- A clock difference between the app and the database flipping a new promo code to "not active yet" (the database's clock now decides).

## What is not covered yet

- Android component tests are written but only run when a phone is connected; there is no automated end-to-end test of the apps themselves.
- Load and failure-injection tests (many drivers pinging at once, Paystack down, Redis down) are not written.
- Payment provider calls are tested against a fake provider and a stand-in for Paystack's web address, never the live Paystack. A payment with Paystack TEST keys has to be run by hand (see "Paystack" below).

## Starting from a clean slate

```
cd backend
npm run reset:test-data -- --yes
```

Removes every rider, driver, ride, payment, application, vehicle plan, promo code, support report, sign-in session and test staff account, and clears the live cache. It keeps the database structure, the car categories (Regular, Comfort, Send Package), the starting fares, the revenue and cancellation rules, the platform's own ledger accounts, the vehicle arrangements, and the staff accounts listed in `KEEP_STAFF` (default `admin@9jaridepro.test`). It refuses to run when `NODE_ENV=production`. Stop the backend first, then start it again afterwards.

The starting fares are placeholders so a ride can be booked on day one. Change them under Trip Fees (a second admin approves the change).

## The temporary sign-in code (0000)

Until an SMS provider is connected, `OTP_MODE=test` (the default): every sign-in code is **0000**, nothing is sent, and the apps show "Testing mode: enter 0000". Testers can ask for codes as often as they like; wrong guesses are still limited to five per code.

Termii is already plugged into `OTP_SENDER` (see "Sign-in codes (Termii)" below): set `TERMII_API_KEY` and `OTP_MODE=live`. Codes become random six digits again, request limits return, and the apps adjust by themselves because the server tells them the code length. The sign-in and sign-up flow does not change. A production start refuses `OTP_MODE=test` unless `OTP_ALLOW_TEST_IN_PRODUCTION=true` is set on purpose.

## Driver sign-up and vehicle arrangements

A driver chooses how they will drive when they apply:

| Arrangement | Driver gives | Staff do on approval |
| --- | --- | --- |
| I own my vehicle (`own`) | plate, make, colour, licence, insurance | approve |
| Get a vehicle through 9jaRide (`platform_plan`) | the kind of car wanted, licence | admin picks the car and sets the payment plan (price, deposit, instalment, how often, first due date) |
| I drive someone else's car (`third_party`) | plate, make, colour, owner name and phone, licence, insurance, the owner's agreement | approve |

Payment plans appear under **Finances, Vehicle plans** (and on the driver's and the vehicle's page). Finance or an admin records each payment; the paid, owed and behind figures are always worked out from that history, which cannot be edited (a mistake is taken back with a reversal). Documents are uploaded as photos in the app (stored in `backend/uploads`, private: only the owner and support/admin staff can open them; set `UPLOAD_DIR` to move them). The application collects personal details, next of kin and the vehicle; the driver asks for Regular or Comfort and the reviewer confirms the category after inspecting the vehicle. A database trigger refuses to approve an application without that confirmation. After submitting, the driver sees a thank-you page saying agents will review it and that they will be notified on WhatsApp or by email (their choice); sending those notifications is not built yet.

## Vehicles, businesses and what is taken from a driver's earnings

Three ways to drive, chosen at sign-up:

| Choice | Who is checked | Vehicle |
| --- | --- | --- |
| I own my vehicle | the driver and the vehicle | the driver gives plate, model, colour, documents |
| I drive someone else's car | the driver and the vehicle | plus the owner's name and phone, and **the share of earnings the driver chooses** to go toward the car |
| Drive a business's vehicle | the driver only | the business gives one from its list (Fleet) after approval and sets the share, which the driver cannot change |

- **Fleet** (admin portal, left menu): one list of vehicles supplied by businesses, with search, filters, pictures and history. A business account sees only its own vehicles. Import many at once from **Excel (.xlsx) or CSV**: "Check the file" first shows every problem line (bad plate, duplicate, unknown category), then "Import" saves the good ones. A blank template can be downloaded from the import window.
- **Businesses** (admin): add a business and its logins. A business login opens straight on Fleet and sees nothing else.
- A vehicle must be **verified** before it can be given out, and it can be with **one driver at a time**; a driver has one vehicle at a time. Every assignment is kept as history.
- On every finished trip, the owner's share is taken from the driver's earnings automatically (for cash trips it comes off the driver's wallet, like the service charge). It stops once the target (the vehicle's price) is reached. The driver sees "Vehicle payment" and "You keep" on the receipt and in their earnings. Owners' balances are in the ledger as `owner:<id>`.
- The earlier fixed-instalment "platform plan" still works for old records but is off for new drivers.

## Alerts in the admin portal
A bell and pop-ups at the top right on every page: new bookings, sign-ups, verifications, support reports, vehicle changes, and (finance/admin) payouts and adjustments. **An SOS stays on screen, red, with a sound, until someone acknowledges it** and wherever you are in the portal.

## Booking alert in the driver app
While online, the app watches for bookings even when it is behind another app. A booking rings loudly (looping, on the alarm volume) and opens over the lock screen. In "Before you go online" the app asks for: notifications, full-screen alerts, and Do Not Disturb access, so the ring is heard. Without a push service (Firebase) a phone that has fully closed the app cannot be reached; that needs Firebase set up later.

## Verifying a NIN
No card photo is needed. The NIN is checked by a service (`NIN_PROVIDER`; today a stand-in that accepts any 11 digits: a number ending 999 fails, ending 000 stays "checking" for a minute). A failed NIN is refused at once with a message; a pending one settles by itself, or an admin can accept it by hand.

## Ratings and feedback
After a trip, **riders rate drivers and drivers rate riders**: 1 to 5 stars, quick comments that change with the stars (5 stars: "Great service", "Smooth ride"...; 1 star: "Very poor service", "Safety concern"...; several can be picked), and an optional written comment. A thank-you shows once it is sent. Staff see it in **Insights, Ratings**: switch between riders rating drivers and drivers rating riders, the stars spread, which quick comments are picked most (with the average stars of those ratings), the lowest rated people, and the written comments.

## Booking Fee and the 9jaRide service charge
The base amount of a fare is the **Booking Fee** (older receipts that said "Service charge" now read "Booking Fee"). The **9jaRide service charge** (12%) is the platform's share, taken from the driver; it is shown separately on the driver's receipt, earnings and the admin Revenue Setup.

## Driver photo
"About you" asks for the driver's photo (camera or gallery). Staff see it with the application; once approved it becomes the driver's profile picture. The owner's signed consent is no longer asked for.

## SOS counter in the admin portal
Top right, always: **SOS Alerts: N**, the alerts that are not resolved (new or acknowledged). It never resets at midnight and falls only when an alert is resolved. Click it to open the Safety Center.

## Live tracking, ETA and distance (two phones)
Use the **real GPS** of the driver's phone: the driver physically moves, the rider watches.
- **Driver to pickup:** the rider sees the car, the road to the pickup, "Arriving in about N min", the distance still to go and the distance the driver has driven so far. When the driver is within about 60 m of the pickup the booking becomes **Arrived** by itself (the driver can still tap "I've arrived").
- **Trip:** after "Start trip" the rider sees the road left to the destination, the time and distance remaining, and the distance travelled. The driver sees the same, and "You have arrived" once within about 80 m of the drop-off; they end the trip.
- **Live or not:** the rider's card says "Live location" or "Last seen 2 min ago" when the driver's phone has stopped reporting. The car slides between readings instead of jumping.
- **Distance rules:** the server adds up the distance between consecutive GPS readings, separately for the way to the pickup and the trip. It ignores readings less precise than 50 m, movement under 8 m (noise), duplicates, and impossible jumps (faster than 160 km/h); three odd readings in a row are taken as the real new place. Change with `TRACK_MAX_ACCURACY_M`, `TRACK_MIN_MOVE_M`, `TRACK_MAX_SPEED_KMH`, `TRACK_JUMPS_BEFORE_RESET`, `TRACK_ARRIVE_RADIUS_M`, `TRACK_DESTINATION_RADIUS_M`.
- Admin Trip detail shows both GPS distances next to the charged distance, and how many readings were used or ignored. The fare still uses the distance the driver app sends, checked against the recorded route.

## Verification: Check status and "what to fix"
- **Check status** shows "Profile Under Verification" while pending, and "Congratulations!" with Continue once approved.
- When staff **Request changes** they tick the parts that need fixing (About you, Next of kin, Vehicle, the photo, or a single document). The driver sees what looks good and what needs an update, is taken straight to those steps only, and everything else stays filled in. A flagged document must be replaced with a new photo. After resubmitting the application is back in review.

## Rider home content
Admin portal, Setup, **Rider home content**: the cards in the rider's "For you", "Ride announcements" and "Safety tips" rows, including the **Invite & Earn** reward amount (write {amount} in the title). Only an admin edits; riders get changes the next time the home screen opens.

## Maps (Mapbox now, Google later)
The map provider is a server setting, not a code change. Place search, addresses for a pin and driving routes are asked of the 9jaRide server, which asks the provider named by `MAPS_PROVIDER` (`mapbox` or `google`; empty means Mapbox when `MAPBOX_ACCESS_TOKEN` is set, otherwise Google when `GOOGLE_MAPS_API_KEY` is set). The apps, the fare and the dispatch never know which one answered. No token goes into git.
- **Server (search, addresses, routes):** `MAPBOX_ACCESS_TOKEN` in the server's environment. It uses Mapbox Search Box and Geocoding for places and addresses, and Directions (with live traffic) for routes and ETAs.
- **Apps (drawing the map):** `mapboxToken=pk...` in `android/local.properties`, or `-PmapboxToken=...` on the build. This is a PUBLIC token; restrict it on mapbox.com to the two app ids. Without it the map is drawn from OpenStreetMap (fine for a quick look, not for a launch).
- **Admin portal (live map):** `VITE_MAPBOX_TOKEN` (public token) in `admin/.env.local` and on the host, restricted to the portal's web address.
- **Later, Google:** set `GOOGLE_MAPS_API_KEY` (Places API (New), Geocoding API, Routes API) and `MAPS_PROVIDER=google`, restart the server. Nothing else changes.
- Place search is Nigeria-wide and puts matches near the phone's position first, then widens; with no position it searches the whole country.
- With no provider set up, search says "not set up" and routes fall back to a marked straight-line estimate (the trip is never blocked by a map outage).
- To check the server's setup as an admin: `GET /maps/status` shows which provider is answering.

## Paystack (wallet top-ups)
1. Put a TEST key in the server: `PAYSTACK_SECRET_KEY=sk_test_...`, and `PUBLIC_API_URL=https://<your api>`.
2. In the Paystack dashboard (Settings, API Keys and Webhooks) set the **Test webhook URL** to `https://<your api>/webhooks/paystack`.
3. In the rider app: Wallet, Top up, Pay. Paystack's page opens in the browser. Use Paystack's test card (for example `4084 0840 8408 4081`, any future expiry, CVV 408; Paystack's docs list the cards that make a payment succeed, fail or ask for a PIN or OTP).
4. Back in the app, a message says what happened: **Payment received** (and the wallet shows the new balance), **Payment not completed** (you closed or cancelled the page), **Payment failed**, or **Confirming your payment** (Paystack has not said yet; it settles itself within a minute or two, by webhook or the hourly check).
5. The wallet is credited only by the server, only after it has asked Paystack and the amount and currency match. Paying twice for the same top-up, or the webhook arriving five times, credits once.
The driver app uses the same flow from Earnings, Fund wallet. Withdrawals (payouts) need a second person to approve them in the admin portal.

## Sign-in codes (Termii)
1. On the server set `OTP_MODE=live`, `TERMII_API_KEY=...`, and `TERMII_SENDER_ID` (a sender name approved on your Termii account; until then Termii's shared `N-Alert` works). Keep the key out of git.
2. Request a code in either app. A text arrives with a 6-digit code valid for 5 minutes. "Call me instead" makes Termii phone the number and read the code out.
3. Limits: 3 requests per number per 10 minutes, 10 per day, 20 per source address per hour; 5 wrong guesses lock a code; a new request cancels the previous code; a code works once.
4. If Termii refuses (wrong key, no balance, sender not approved, number cannot receive texts), the person is told the code could not be sent (or that the number is not valid), and the server log names the reason without the key or the code.
5. A network failure or Termii outage is tried once more before giving up.

## Push notifications (Firebase)
The apps register their phone with the server after sign-in. Once the server has the Firebase key:
- a **new booking** rings the driver's phone even when the app is closed (only while they are online);
- the **rider** is told when a driver accepts, arrives, starts and ends the trip, or cancels, or no driver is found;
- the **driver** is told when their application is approved, needs an update, or is not approved.
To switch it on: Firebase console, Project settings, Service accounts, **Generate new private key**. On Render, open the API service, Environment, add `FIREBASE_SERVICE_ACCOUNT` and paste the whole JSON file as the value. Locally, put `FIREBASE_SERVICE_ACCOUNT_FILE=C:\path\to\the-key.json` in `backend/.env`. Never commit the key. The server log says "push notifications are on" when it works.
