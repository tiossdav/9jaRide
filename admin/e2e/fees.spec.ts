import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

test('a fee change cannot be approved by the person who proposed it, and can be discarded', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await page.goto('/pricing');
  await page.getByRole('button', { name: 'Propose new fees' }).first().click();
  // far in the future so the live prices other work relies on are never touched
  // a start time no earlier run has used, because two versions cannot start at the same moment
  const pad = (n: number) => String(n).padStart(2, '0');
  const t = new Date(Date.UTC(2100, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), Math.floor(Math.random() * 24), Math.floor(Math.random() * 60)));
  await page.getByLabel('Starts').fill(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`);
  await page.getByRole('button', { name: 'Propose', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, propose' }).click();
  await expect(page.getByText('Waiting for approval')).toBeVisible();

  await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await page.getByRole('button', { name: 'Yes, approve' }).click();
  await expect(page.getByRole('alert')).toContainText('different admin');
  await page.getByRole('button', { name: 'Go back' }).click();

  await page.getByRole('button', { name: 'Discard' }).first().click();
  await page.getByRole('button', { name: 'Yes, discard' }).click();
  await expect(page.getByText('Proposal discarded')).toBeVisible();
});
