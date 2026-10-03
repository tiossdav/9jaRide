import { expect, test } from '@playwright/test';
import { signIn, signInAs } from './helpers';

test('an admin invites someone, who must choose their own password before using the portal', async ({ page, browser }) => {
  await signInAs(page, 'ADMIN');
  await page.goto('/team');
  await page.getByRole('button', { name: /Invite Member/ }).click();
  const email = `e2e-invitee-${Date.now()}@example.test`;
  await page.getByLabel('First name').fill('Ada');
  await page.getByLabel('Last name').fill('Tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Role').selectOption('support');
  await page.getByRole('button', { name: 'Create account' }).click();
  // the second click
  await expect(page.getByText('Create an account for Ada Tester?')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, create account' }).click();

  await expect(page.getByText(/One-time password for Ada Tester/)).toBeVisible();
  const temp = ((await page.locator('.modal div.input').first().textContent()) ?? '').trim();
  expect(temp.length).toBeGreaterThanOrEqual(12);
  await page.getByRole('button', { name: 'I have passed it on' }).click();
  await expect(page.getByText(email)).toBeVisible();

  // the invitee, in a fresh browser
  const other = await browser.newPage();
  await signIn(other, email, temp);
  await expect(other.getByText('Choose your own password')).toBeVisible();
  await expect(other.getByRole('button', { name: 'Cancel' })).toHaveCount(0); // cannot skip it
  await other.getByLabel(/Current password/).fill(temp);
  await other.getByLabel(/^New password/).fill('a-brand-new-passphrase-9');
  await other.getByLabel(/Confirm new password/).fill('a-brand-new-passphrase-9');
  await other.getByRole('button', { name: 'Update Password' }).click();
  await expect(other.getByText('Choose your own password')).toHaveCount(0);
  await expect(other.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(other.locator('aside').getByText('Team', { exact: true })).toHaveCount(0); // support, not admin
  await other.close();
});

test('switching someone off asks first and then really stops them signing in', async ({ page, browser }) => {
  await signInAs(page, 'ADMIN');
  await page.goto('/team');
  await page.getByLabel('Search members').fill(process.env.E2E_SUPPORT!);
  await page.getByText(process.env.E2E_SUPPORT!).first().click();
  await page.getByRole('button', { name: 'Switch off' }).click();
  await expect(page.getByText(/Switch off E2E-support\?/)).toBeVisible();
  await page.getByRole('button', { name: 'Yes, switch off' }).click();
  await expect(page.getByText('Switched off').first()).toBeVisible();

  const other = await browser.newPage();
  await signIn(other, process.env.E2E_SUPPORT!, process.env.E2E_PASSWORD!);
  await expect(other.getByRole('alert')).toHaveText('Wrong email or password.');
  await other.close();

  await page.getByRole('button', { name: 'Restore access' }).click();
  await page.getByRole('button', { name: 'Yes, restore' }).click();
  await expect(page.getByRole('button', { name: 'Switch off' })).toBeVisible();
});
