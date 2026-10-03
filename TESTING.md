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
2. `npm run test:int` writes to the database named by `DATABASE_URL` (default `postgres://jaride:jaride@localhost:5432/jaride`). **Stop any running backend that uses the same database first**: the suites share one database and a live server can disturb them.

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
DATABASE_URL=postgres://jaride:jaride@localhost:5432/jaride JWT_SECRET=any-long-random-string-at-least-32-chars ADMIN_ORIGIN=http://localhost:5173 node dist/src/main.js

# terminal 2
cd admin && npm run e2e
```

The tests create their own staff accounts for the run (through `backend/scripts/create-staff.ts`) and never touch yours. A failing test leaves a screenshot, a trace and an `error-context.md` under `admin/test-results/`; open the trace with `npx playwright show-trace <trace.zip>` to step through what the browser did. The HTML report is `admin/playwright-report/`.

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

## What is not covered yet

- Android component tests are written but only run when a phone is connected; there is no automated end-to-end test of the apps themselves.
- Load and failure-injection tests (many drivers pinging at once, Paystack down, Redis down) are not written.
- Payment provider calls are tested against a fake provider, never the live Paystack.
