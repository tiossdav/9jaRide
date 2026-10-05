# Battery use of the apps

Live location is what the product is for, so it stays; the cost is cut by asking the phone for less when less is needed, by making fewer network requests, and by doing nothing while nobody is looking.

## What the driver app does now

| Situation | Position asked of the phone | Sent to the server | Waiting for bookings |
| --- | --- | --- | --- |
| Online, waiting for a booking | GPS every 10 s, but only after the car has moved 15 m; network position every 30 s as a fallback | every 15 s. A parked car sends a "still here" heartbeat; after 3 minutes with no real fix the heartbeat stops, so a driver whose GPS died does not look online | one request is held open by the server for up to 20 s, so about 3 requests a minute (it was about 20), and a booking is still heard at once |
| On a trip (to the pickup, waiting, driving) | GPS every 3 s, network every 15 s | every 5 s, because the rider is watching the car | none needed |
| Offline | nothing, except the Home map (below) | nothing | nothing |
| App behind another app or screen off, online | as above, from the foreground service the driver already sees in the notification | as above | as above |

- The Home map no longer runs its own GPS while the driver is online (it borrows the service's position). Offline it asks every 15 s / 25 m, and only while the app is on screen.
- The screens used to ask for bookings too, doubling the requests; now only the background service asks and the screens read what it found.
- While a ride is in progress the app checks it every 6 s (before: 3 s); with no ride it checks every 30 s.
- No wake locks are held. The unused wake-lock permission was removed.
- The "let the app run in the background" prompt stays for drivers only: a phone that goes into Doze with the screen off can stop network access for a waiting driver, which is the one case where the exemption is justified. It is shown once, with the reason, and the app works without it (it is advice, not a block).

## What the rider app does now

- The status of a ride is asked for with the server holding the answer until it changes (up to 20 s): about 3 requests a minute instead of 20, and "driver arrived" is still heard at once.
- The car's position (needed for the live map and the arrival time) is fetched every 5 s, only while the app is on screen and the car is on its way; every 10 s once it has arrived.
- The phone's own GPS is asked every 10 s and only after 15 m of movement, and is switched off when the app goes behind another one.
- The "searching" clock counts in memory; it makes no requests.

## Server side
`GET /driver/offer?wait=20` and `GET /rides/:id?waitFor=<status>&wait=20` hold the request (at most 25 s) and answer as soon as something changes. A driver counts as online for 45 s after the last report (`DRIVER_STATE_TTL_SECONDS`).

## What is not done yet, and why
- **Push notifications (Firebase).** With them a phone would not need the held-open request at all, and a fully closed app could still be reached. They need a Firebase project, which only you can create.
- **Fused location (Google Play services).** It saves a little more power, but is missing on phones without Google services. The plain Android location service used here works everywhere. It can be added as an option later.
- **Measured results.** The numbers above are request counts and settings I changed, not battery percentages; those need a phone and a few hours of driving. To measure:
  1. `adb shell dumpsys batterystats --reset`, use the app for an hour online, then
  2. `adb shell dumpsys batterystats --charged com.ninejaride.driver` (look at "Estimated power use" and the GPS / wakeup lines), or Settings, Battery, App usage on the phone.
  Compare with the earlier APK (`apk/9jaRide-driver-test.apk`) side by side on two phones for a fair test.
