// Runs the integration tests against the local database, on any operating system.
// Usage: npm run test:int [-- <jest args>]   (set DATABASE_URL to use a different database)
const { spawnSync } = require('child_process');

const env = {
  ...process.env,
  INTEGRATION: '1',
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://jaride:jaride@localhost:5432/jaride',
};
// One file at a time: the suites share one database, and a running dev server on the same database can disturb them.
const args = ['jest', '--runInBand', ...process.argv.slice(2)];
const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
