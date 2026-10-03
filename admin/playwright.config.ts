import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real portal in a real browser against the real backend and database.
 * Start the backend first (see TESTING.md; it must allow http://localhost:4173), then run `npm run e2e`. It uses the Chrome already installed on this machine.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1, // one shared database: tests run one after another
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  // The built site, served the way production will serve it: far lighter on the machine than the dev server, so the tests are steadier.
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 240_000 },
});
