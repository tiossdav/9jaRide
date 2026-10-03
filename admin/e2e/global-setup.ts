import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Creates fresh staff accounts for this run (through the same script real staff are made with), so tests never depend
 * on, or disturb, anybody's real login. Also refuses to start if the backend is not up.
 */
export default async function globalSetup() {
  const api = process.env.E2E_API ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${api}/health`);
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    throw new Error(`The backend is not answering at ${api}. Start it first (see admin/TESTING.md), then run the tests again.`);
  }
  const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend');
  const stamp = Date.now();
  const password = 'e2e-password-correct-horse-1';
  const make = (role: string, n = '') => {
    const email = `e2e-${role}${n}-${stamp}@example.test`;
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['ts-node', 'scripts/create-staff.ts', email, `E2E-${role}`, role], {
      cwd: backend,
      shell: process.platform === 'win32',
      env: { ...process.env, STAFF_PASSWORD: password, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://jaride:jaride@localhost:5432/jaride' },
      stdio: 'pipe',
    });
    return email;
  };
  process.env.E2E_PASSWORD = password;
  process.env.E2E_ADMIN = make('admin');
  process.env.E2E_ADMIN2 = make('admin', '2');
  process.env.E2E_SUPPORT = make('support');
  process.env.E2E_API = api;
}
