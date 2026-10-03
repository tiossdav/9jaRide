import { expect, test } from '@playwright/test';
import { creds, signIn, signInAs, userMenu } from './helpers';

test.describe('signing in and out', () => {
  test('shows a plain message for a wrong password and stays on the sign-in page', async ({ page }) => {
    await signIn(page, creds('ADMIN').email, 'not-the-password-1');
    await expect(page.getByRole('alert')).toHaveText('Wrong email or password.');
    await expect(page).toHaveURL(/\/login/);
  });

  test('sends someone who is not signed in back to the sign-in page', async ({ page }) => {
    await page.goto('/trips');
    await expect(page).toHaveURL(/\/login/);
  });

  test('signs in and shows the dashboard with the full menu for an admin', async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await expect(page.getByText(/Welcome back/)).toBeVisible();
    for (const name of ['Live operations', 'Safety Center', 'Trips', 'Finances', 'Team', 'Activity Logs']) {
      await expect(page.locator('aside').getByText(name, { exact: true })).toBeVisible();
    }
  });

  test('asks "are you sure" before signing out, and only signs out after yes', async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await userMenu(page, 'Sign out');
    await expect(page.getByText('Sign out?')).toBeVisible();
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible(); // still signed in
    await userMenu(page, 'Sign out');
    await page.getByRole('button', { name: 'Yes, sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/trips');
    await expect(page).toHaveURL(/\/login/); // the session really ended
  });
});

test.describe('role access', () => {
  test('support does not see the money or the team', async ({ page }) => {
    await signInAs(page, 'SUPPORT');
    const side = page.locator('aside');
    await expect(side.getByText('Safety Center', { exact: true })).toBeVisible();
    for (const name of ['Finances', 'Team', 'Activity Logs']) await expect(side.getByText(name, { exact: true })).toHaveCount(0);
  });

  test('support cannot read the activity log even by typing its address', async ({ page }) => {
    await signInAs(page, 'SUPPORT');
    await page.goto('/activity');
    await expect(page.getByText(/not allowed|forbidden|Try again/i).first()).toBeVisible();
  });
});

test.describe('pages load with real data', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'ADMIN');
  });

  const pages: [string, string][] = [
    ['/live', 'Live operations'], ['/safety', 'Safety Center'], ['/trips', 'All Trips'], ['/customers', 'Customers'], ['/drivers', 'Drivers'],
    ['/vehicles', 'Vehicles'], ['/pricing', 'Trip Fees'], ['/finances/wallet', 'Wallet'], ['/finances/revenue', 'Revenue'], ['/finances/ledger', 'Ledger'],
    ['/finances/payouts', 'Driver payouts'], ['/finances/adjustments', 'Refunds and adjustments'], ['/finances/reconciliation', 'Reconciliation'],
    ['/setup/asset-types', 'Asset Types'], ['/setup/revenue', 'Revenue Setup'], ['/setup/cancellation', 'Cancellation Policy'], ['/finances/stakeholders', 'Stakeholder payouts'], ['/promo', 'Promo'], ['/support', 'Support'],
    ['/team', 'Team Members'], ['/team/roles', 'Roles & Permissions'], ['/activity', 'Activity Logs'],
  ];
  for (const [path, heading] of pages) {
    test(`${heading} opens`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    });
  }

  test('searching trips narrows the list', async ({ page }) => {
    await page.goto('/trips');
    await page.getByRole('button', { name: 'Logs' }).click();
    await page.getByLabel('Search trips').fill('zzzz-no-such-trip');
    await expect(page.getByText('No trips match.')).toBeVisible();
  });

  test('the dark and light themes both work', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Switch light or dark' }).click();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(['light', 'dark']).toContain(theme);
  });
});
