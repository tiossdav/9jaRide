import { expect, Page } from '@playwright/test';

export const creds = (who: 'ADMIN' | 'ADMIN2' | 'SUPPORT') => ({ email: process.env[`E2E_${who}`]!, password: process.env.E2E_PASSWORD! });

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signInAs(page: Page, who: 'ADMIN' | 'ADMIN2' | 'SUPPORT') {
  const c = creds(who);
  await signIn(page, c.email, c.password);
  await expect(page.getByRole('heading', { name: /Dashboard|Wallet/ })).toBeVisible();
}

/** Opens the user menu at the top right and picks an entry. */
export async function userMenu(page: Page, item: string) {
  await page.locator('.user').click();
  await page.getByRole('menuitem', { name: item }).click();
}
