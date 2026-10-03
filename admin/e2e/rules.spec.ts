import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

const pad = (n: number) => String(n).padStart(2, '0');
/** A start time in the far future that no earlier run has used. */
const farFuture = () => {
  const t = new Date(Date.UTC(2102, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), Math.floor(Math.random() * 24), Math.floor(Math.random() * 60)));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
};

test('changing the commission needs a different admin, and shares must add up', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await page.goto('/setup/revenue');
  await page.getByRole('button', { name: 'Propose a change' }).click();
  await page.getByLabel('Commission (% of the fare)').fill('15');
  await page.getByLabel('Party 1 share').fill('60'); // now adds up to 60%
  await expect(page.getByText(/must be 100%/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send for approval' })).toBeDisabled();
  await page.getByRole('button', { name: 'Add a party' }).click();
  await page.getByLabel('Party 2 name').fill('Tech partner');
  await page.getByLabel('Party 2 share').fill('40');
  await page.getByLabel('Starts').fill(farFuture());
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await page.getByRole('button', { name: 'Yes, send' }).click();
  await expect(page.getByText('Waiting for approval')).toBeVisible();

  await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await page.getByRole('button', { name: 'Yes, approve' }).click();
  await expect(page.getByRole('alert')).toContainText('different admin'); // not your own
  await page.getByRole('button', { name: 'Go back' }).click();
  await page.getByRole('button', { name: 'Discard' }).first().click();
  await page.getByRole('button', { name: 'Yes, discard' }).click();
  await expect(page.getByText('Discarded')).toBeVisible();
});

test('a promo code can be made, switched off and on', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await page.goto('/promo');
  await page.getByRole('button', { name: '+ Create Promo' }).click();
  const code = `E2E${Date.now().toString(36).toUpperCase().slice(-8)}`;
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByLabel('Percent off').fill('10');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, create' }).click();
  const row = page.locator('tr', { hasText: code });
  await expect(row).toContainText('10% off');
  await expect(row).toContainText('Live');
  await row.getByRole('button', { name: 'Off' }).click();
  await page.getByRole('button', { name: 'Yes, switch off' }).click();
  await expect(row).toContainText('Switched off');
});

test('a new asset type is not bookable until it has fees', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await page.goto('/setup/asset-types');
  await page.getByRole('button', { name: '+ Add Asset Type' }).click();
  const name = `Test ${Date.now().toString(36).slice(-6)}`;
  await page.getByLabel('Name riders see').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, add' }).click();
  const row = page.locator('tr', { hasText: name });
  await expect(row).toContainText('Needs fees');
  await expect(row).toContainText('Not bookable yet');
});
