# 9jaRide, Android apps

Kotlin and Jetpack Compose, built from the "9jaRide Pro" design canvas. Three Gradle modules:

| Module | What it is |
| --- | --- |
| `:core` | Shared theme (light and dark), components, map, routing, geocoding, API client, money formatting, device location. |
| `:driver` | The driver app (9jaRide Pro). Package `com.ninejaride.driver`. |
| `:rider` | The rider app. Package `com.ninejaride.rider`. Always talks to the real backend (booking needs live prices and drivers). |

## Run it

Start the backend first (`backend/`, see its README), then with a phone on USB:

```
adb reverse tcp:3000 tcp:3000
./gradlew :rider:installDebug                                       # rider app
./gradlew :driver:installDebug -PdemoMode=false -PapiBase=http://localhost:3000   # driver app against the real backend
```

Emulator: use `-PapiBase=http://10.0.2.2:3000` instead. Windows: set `JAVA_HOME` to Android Studio's `jbr` folder. The driver app defaults to **demo mode** (sample data, scripted ride, no server) unless `-PdemoMode=false`.

Both apps use 6-digit codes (the design shows 4; the server issues 6 and limits guesses). A new number in the rider app is registered with the name typed on the sign-up screen.

## Driver app: real versus sample

Real: sign-in, forced-update check, and **background location** (foreground service of type `location`, offline queue that flushes to `POST /driver/location/batch`, battery-optimisation prompts from `GET /app/config`, resumes after reboot). Everything else (offers, the ride, earnings, payouts, profile) is still sample data and a scripted ride; the backend endpoints for these do not exist yet.

## Rider app: what it does (all against the real backend)

Sign up and sign in with an SMS or voice code, location permission, a live map, search or pin a pickup and drop-off, fares by category with the range and payment choice (cash or wallet with the hold), requesting a ride, searching with a timer and cancel reasons, the driver's position, name, rating, vehicle and call button as they approach, in-trip view, SOS, trip complete with receipt and rating, scheduled and weekly rides (list, cancel next or whole series), trip history and details, wallet with activity and Paystack top-up (opens in the browser), appearance (system, light, dark), help, delete-account guidance.

Deliberate gaps: referral rewards, inbox messages, in-app problem reports (the Help screen points to email), editing name or number, and push notifications. The "report a problem" button goes to Help.

## Before launch

- **Maps, routes, place search:** OpenStreetMap tiles, the public OSRM demo server and Nominatim are development-only. Swap `ui/components/MapPanel.kt`, `data/Routing.kt` and `data/Geocoding.kt` for paid providers; the screens do not change.
- **Tokens** are in app-private preferences; move them to the Android Keystore.
- **Push notifications** (driver offers, rider updates) are not built; the rider app polls every 3 seconds while open.
- **Service charge:** the design takes 12% of the fare including tax (₦271.20 on ₦2,260); the backend takes it without tax (₦267.60). Decide with your accountant.
- **Not tested:** screen-off background location on real battery-aggressive phones (Tecno, Infinix, Xiaomi), and the iOS apps (Swift) are not started.
