# Hosting a test copy on Render

`render.yaml` describes everything: the API, a PostGIS database, a Redis-compatible cache and the admin portal. You do the account steps; the code is ready.

## 1. Put the code on GitHub
Render builds from your repository. Push `main` (it already contains `render.yaml`).

## 2. Create it on Render
1. Sign in at render.com and connect your GitHub account.
2. **New, Blueprint**, choose the `9jaRide` repository, branch `main`.
3. Render shows the four things it will create. It asks for two values:
   - `ADMIN_BOOTSTRAP_EMAIL`: the email of the first admin.
   - `ADMIN_BOOTSTRAP_PASSWORD`: at least 12 characters. Use a strong one; the portal is on the internet.
4. **Apply**. The first build takes several minutes.

When it is live:
- API: `https://ninejaride-api.onrender.com/health` should answer `{"ok":true}`.
- Admin portal: `https://ninejaride-admin.onrender.com`, sign in with the email and password above.

If Render says a name is taken, rename it in `render.yaml` and update `ADMIN_ORIGIN` (api) and `VITE_API_BASE` (admin) to match.

On the first start the API runs the migrations, creates the first admin, and adds the starting fares (change them under Trip Fees; a second admin approves changes, so create one under Team).

## 3. Point the apps at it
The apps need to be built with the API address:

```
cd android
./gradlew :driver:assembleDebug :rider:assembleDebug -PdemoMode=false -PapiBase=https://ninejaride-api.onrender.com
```
The APKs are in `android/driver/build/outputs/apk/debug/` and `android/rider/build/outputs/apk/debug/`. They work on any phone and any network.

## What to know about the free plans
- The API sleeps after 15 minutes idle; the first request after that takes about a minute. Open the health address before a test session to wake it. Drivers who stay online keep it awake.
- The free database is removed after 30 days. Choose a paid plan in `render.yaml` to keep the data.
- Uploaded photos and documents are kept in the database (`FILE_STORAGE=db`), so they survive restarts.
- The 0000 sign-in code is on (`OTP_MODE=test`). Anyone who knows the address can create an account. When an SMS provider is ready, connect it and set `OTP_MODE=live`.
- Payments (Paystack) are not configured, so wallet top-ups and payouts will not work on this copy.
- The reset script is for your own machine. To start a hosted copy over, delete and recreate the database on Render.
